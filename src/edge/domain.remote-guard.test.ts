// src/edge/domain.remote-guard.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "domain-remote-guard-"));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.HOME = dir;

const { bindDomain } = await import("./domain.ts");
const { FakeTunnelDriver } = await import("./tunnel.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { getPlatformSettings, reloadPlatformSettings, updatePlatformSettings } = await import("../api/platform-settings.ts");
const { putRecord, reloadRegistry } = await import("../registry/records.ts");

let cfDir: string;
let fakeTunnel: FakeTunnelDriver;
let fakeManager: FakeServiceManager;

beforeEach(() => {
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  process.env.HOME = mkdtempSync(join(tmpdir(), "domain-remote-guard-home-"));
  reloadPlatformSettings();
  reloadRegistry();
  cfDir = mkdtempSync(join(tmpdir(), "domain-remote-guard-cfdir-"));
  fakeTunnel = new FakeTunnelDriver();
  fakeManager = new FakeServiceManager();
  writeFileSync(join(cfDir, "cert.pem"), "x"); // login evidence
});

test("re-binding to a different domain refuses while an app is remote-on", async () => {
  // Set the current domain to m4tthew.dev
  updatePlatformSettings({ publicDomain: "m4tthew.dev" });

  // Create a record with remote enabled
  putRecord({
    name: "site",
    managedBy: "user",
    port: 3000,
    kind: "service",
    createdAt: new Date().toISOString(),
    remote: {
      target: "railway",
      serviceId: "test-service",
      customDomain: "site.m4tthew.dev",
      status: "live",
    },
  });

  // Try to bind to a different domain
  const r = await bindDomain("other.dev", { tunnel: fakeTunnel, manager: fakeManager }, { cloudflaredDir: cfDir });
  expect(r.status).toBe(409);
  expect((r.body as any).error).toBe("remote-apps-pinned-to-domain");
  expect((r.body as any).apps).toContain("site");
});

test("re-binding to the SAME domain is allowed (idempotent)", async () => {
  // Set the current domain to m4tthew.dev
  updatePlatformSettings({ publicDomain: "m4tthew.dev" });

  // Create a record with remote enabled
  putRecord({
    name: "site",
    managedBy: "user",
    port: 3000,
    kind: "service",
    createdAt: new Date().toISOString(),
    remote: {
      target: "railway",
      serviceId: "test-service",
      customDomain: "site.m4tthew.dev",
      status: "live",
    },
  });

  // Try to bind to the SAME domain
  const r = await bindDomain("m4tthew.dev", { tunnel: fakeTunnel, manager: fakeManager }, { cloudflaredDir: cfDir });
  expect(r.status).not.toBe(409);
});
