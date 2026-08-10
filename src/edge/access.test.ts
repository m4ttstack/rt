// src/edge/access.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-access-driver-"));
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_ACCESS_PATH = join(dir, "access.json");

const { CfAccess, tierToInclude, syncAccessTier } = await import("./access.ts");

test("tierToInclude maps each identity tier to CF include rules", () => {
  expect(tierToInclude({ tier: "only-me", email: "m@x.dev" })).toEqual([{ email: { email: "m@x.dev" } }]);
  expect(tierToInclude({ tier: "work-domain", emailDomain: "corp.com" })).toEqual([{ email_domain: { domain: "corp.com" } }]);
  expect(tierToInclude({ tier: "custom", emails: ["a@x.dev", "b@x.dev" ] })).toEqual([
    { email: { email: "a@x.dev" } }, { email: { email: "b@x.dev" } },
  ]);
});

function cannedCf() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "GET" && u.includes("/access/apps")) {
      return Response.json({ success: true, result: [] });
    }
    if (method === "POST" && u.endsWith("/access/apps")) {
      return Response.json({ success: true, result: { id: "app-1" } });
    }
    return Response.json({ success: true, result: { id: "pol-1" } });
  }) as typeof fetch;
  return { calls, impl };
}

test("sync on a fresh hostname creates the Access app then its allow policy", async () => {
  const { calls, impl } = cannedCf();
  const cf = new CfAccess({ token: "tok", zoneId: "z1", fetchImpl: impl });
  await cf.sync("myapp", "myapp.example.dev", { tier: "only-me", email: "m@x.dev" });
  expect(calls[0]!.url).toContain("/zones/z1/access/apps");
  const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/access/apps"))!;
  expect(create.body).toMatchObject({ domain: "myapp.example.dev", type: "self_hosted" });
  const policy = calls.find((c) => c.url.includes("/access/apps/app-1/policies"))!;
  expect(policy.body).toMatchObject({ decision: "allow", include: [{ email: { email: "m@x.dev" } }] });
});

test("syncAccessTier without a token degrades loudly, not silently", async () => {
  // registry + settings scratch env as in earlier tests; no cfApiToken set
  const { putRecord, getRecord, reloadRegistry } = await import("../registry/records.ts");
  reloadRegistry();
  putRecord({ name: "app-x", managedBy: "user", port: 11000, kind: "external", createdAt: "2026-08-10T00:00:00Z" });
  const r = await syncAccessTier("app-x", { tier: "only-me", email: "m@x.dev" }, {} as never);
  expect(r.ok).toBe(false);
  expect(getRecord("app-x")!.issues!.some((i) => i.source === "cloudflare")).toBe(true);
});

test("syncAccessTier on a CF API error degrades loudly and never leaks the token", async () => {
  const { putRecord, getRecord, reloadRegistry } = await import("../registry/records.ts");
  const { updatePlatformSettings, reloadPlatformSettings } = await import("../api/platform-settings.ts");
  reloadRegistry();
  reloadPlatformSettings();
  const secretToken = "secret-token-should-never-appear-12345";
  updatePlatformSettings({
    publicDomain: "example.dev",
    secrets: { cfApiToken: secretToken, cfZoneId: "z1" },
  });
  putRecord({ name: "app-err", managedBy: "user", port: 11001, kind: "external", createdAt: "2026-08-10T00:00:00Z" });

  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method === "GET" && u.includes("/access/apps")) {
      return Response.json({ success: true, result: [] });
    }
    if (method === "POST" && u.endsWith("/access/apps")) {
      // Simulate a Cloudflare API failure creating the Access app.
      return Response.json({ success: false, errors: [{ code: 1000, message: "bad request" }] }, { status: 400 });
    }
    return Response.json({ success: true, result: { id: "pol-1" } });
  }) as typeof fetch;

  const r = await syncAccessTier(
    "app-err",
    { tier: "only-me", email: "m@x.dev" },
    { accessFetch: impl } as unknown as never,
  );

  expect(r.ok).toBe(false);
  const issue = getRecord("app-err")!.issues!.find((i) => i.source === "cloudflare");
  expect(issue).toBeDefined();
  expect(issue!.message).not.toContain(secretToken);
});

test("CfAccess.sync on an existing hostname updates the app and replaces its policy", async () => {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "GET" && u.endsWith("/access/apps")) {
      return Response.json({ success: true, result: [{ id: "app-9", domain: "existing.example.dev" }] });
    }
    if (method === "PUT" && u.endsWith("/access/apps/app-9")) {
      return Response.json({ success: true, result: { id: "app-9", domain: "existing.example.dev" } });
    }
    if (method === "GET" && u.endsWith("/access/apps/app-9/policies")) {
      return Response.json({ success: true, result: [{ id: "pol-9", name: "local tier" }] });
    }
    if (method === "PUT" && u.endsWith("/access/apps/app-9/policies/pol-9")) {
      return Response.json({ success: true, result: { id: "pol-9" } });
    }
    throw new Error(`unexpected call: ${method} ${u}`);
  }) as typeof fetch;

  const cf = new CfAccess({ token: "tok", zoneId: "z1", fetchImpl: impl });
  await cf.sync("myapp", "existing.example.dev", { tier: "only-me", email: "m@x.dev" });

  // No creates: the existing app and policy must be updated in place, not re-created.
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  const updateApp = calls.find((c) => c.method === "PUT" && c.url.endsWith("/access/apps/app-9"))!;
  expect(updateApp.body).toMatchObject({ domain: "existing.example.dev", type: "self_hosted" });
  const replacePolicy = calls.find((c) => c.method === "PUT" && c.url.endsWith("/access/apps/app-9/policies/pol-9"))!;
  expect(replacePolicy.body).toMatchObject({ decision: "allow", include: [{ email: { email: "m@x.dev" } }] });
});
