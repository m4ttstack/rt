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
