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
// deck.platform reads through rt-client, which resolves HOME at call time (not overridable
// via a LOCAL_*_PATH var) -- must be faked here too, or this test touches the real ~/.mattstack.
process.env.HOME = dir;

const { CfAccess, oauthToInclude, syncOAuth } = await import("./access.ts");

test("oauthToInclude maps each on-mode to CF include rules", () => {
  expect(oauthToInclude({ mode: "emails", emails: ["m@x.dev"] }))
    .toEqual([{ email: { email: "m@x.dev" } }]);
  expect(oauthToInclude({ mode: "emails", emails: ["a@x.dev", "b@x.dev"] }))
    .toEqual([{ email: { email: "a@x.dev" } }, { email: { email: "b@x.dev" } }]);
  expect(oauthToInclude({ mode: "domains", domains: ["corp.com"] }))
    .toEqual([{ email_domain: { domain: "corp.com" } }]);
  expect(oauthToInclude({ mode: "domains", domains: ["corp.com", "other.dev"] }))
    .toEqual([{ email_domain: { domain: "corp.com" } }, { email_domain: { domain: "other.dev" } }]);
  expect(oauthToInclude({ mode: "off" })).toEqual([]);
});

function cannedCf() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
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
  await cf.sync("myapp", "myapp.example.dev", { mode: "emails", emails: ["m@x.dev"] });
  expect(calls[0]!.url).toContain("/zones/z1/access/apps");
  const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/access/apps"))!;
  expect(create.body).toMatchObject({ domain: "myapp.example.dev", type: "self_hosted" });
  const policy = calls.find((c) => c.url.includes("/access/apps/app-1/policies"))!;
  expect(policy.body).toMatchObject({ decision: "allow", include: [{ email: { email: "m@x.dev" } }] });
});

test("syncOAuth without a token degrades loudly, not silently", async () => {
  // registry + settings scratch env as in earlier tests; no cfApiToken set
  const { putRecord, getRecord, reloadRegistry } = await import("../registry/records.ts");
  reloadRegistry();
  putRecord({ name: "app-x", managedBy: "user", port: 11000, kind: "external", createdAt: "2026-08-10T00:00:00Z" });
  const r = await syncOAuth("app-x", { mode: "emails", emails: ["m@x.dev"] }, {} as never);
  expect(r.ok).toBe(false);
  expect(getRecord("app-x")!.issues!.some((i) => i.source === "cloudflare")).toBe(true);
});

test("syncOAuth on a CF API error degrades loudly and never leaks the token", async () => {
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

  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
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

  const r = await syncOAuth(
    "app-err",
    { mode: "emails", emails: ["m@x.dev"] },
    { accessFetch: impl } as unknown as never,
  );

  expect(r.ok).toBe(false);
  const issue = getRecord("app-err")!.issues!.find((i) => i.source === "cloudflare");
  expect(issue).toBeDefined();
  expect(issue!.message).not.toContain(secretToken);
});

test("syncOAuth clears its own cloudflare issue once credentials are fixed and a later sync succeeds", async () => {
  const { putRecord, getRecord, reloadRegistry } = await import("../registry/records.ts");
  const { updatePlatformSettings, reloadPlatformSettings } = await import("../api/platform-settings.ts");
  reloadRegistry();
  reloadPlatformSettings();
  updatePlatformSettings({
    publicDomain: "example.dev",
    secrets: { cfApiToken: undefined, cfZoneId: undefined },
  });
  putRecord({ name: "app-fixed", managedBy: "user", port: 11003, kind: "external", createdAt: "2026-08-10T00:00:00Z" });

  // First sync fails loudly for lack of credentials.
  const failed = await syncOAuth("app-fixed", { mode: "emails", emails: ["m@x.dev"] }, {} as never);
  expect(failed.ok).toBe(false);
  expect(getRecord("app-fixed")!.issues!.some((i) => i.source === "cloudflare")).toBe(true);

  // Credentials get fixed, and a later sync against a canned-success fetch
  // must clear the stale badge, not leave it permanent.
  updatePlatformSettings({ secrets: { cfApiToken: "tok", cfZoneId: "z1" } });
  const { impl } = cannedCf();
  const ok = await syncOAuth("app-fixed", { mode: "emails", emails: ["m@x.dev"] }, { accessFetch: impl } as unknown as never);
  expect(ok.ok).toBe(true);
  expect(getRecord("app-fixed")!.issues?.some((i) => i.source === "cloudflare")).toBeFalsy();
});

test("syncOAuth guards against a null publicDomain instead of building a bogus hostname", async () => {
  const { putRecord, reloadRegistry } = await import("../registry/records.ts");
  const { updatePlatformSettings, reloadPlatformSettings } = await import("../api/platform-settings.ts");
  reloadRegistry();
  reloadPlatformSettings();
  updatePlatformSettings({
    publicDomain: null,
    secrets: { cfApiToken: "tok", cfZoneId: "z1" },
  });
  putRecord({ name: "app-nodomain", managedBy: "user", port: 11004, kind: "external", createdAt: "2026-08-10T00:00:00Z" });

  const impl = (async () => {
    throw new Error("must not call Cloudflare when no domain is bound yet");
  }) as unknown as typeof fetch;

  const r = await syncOAuth(
    "app-nodomain",
    { mode: "emails", emails: ["m@x.dev"] },
    { accessFetch: impl } as unknown as never,
  );

  expect(r.ok).toBe(false);
  expect(r.message).toContain("bind a domain");
});

test("syncOAuth off tears the Access app down at a configured zone", async () => {
  const { putRecord, getRecord, reloadRegistry } = await import("../registry/records.ts");
  const { updatePlatformSettings, reloadPlatformSettings } = await import("../api/platform-settings.ts");
  reloadRegistry();
  reloadPlatformSettings();
  updatePlatformSettings({
    publicDomain: "example.dev",
    secrets: { cfApiToken: "tok", cfZoneId: "z1" },
  });
  putRecord({
    name: "app-off", managedBy: "user", port: 11005, kind: "external",
    createdAt: "2026-08-10T00:00:00Z",
    issues: [{ source: "cloudflare", message: "stale", at: "2026-08-10T00:00:00Z" }],
  });

  const calls: { method: string; url: string }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u });
    if (method === "GET" && u.endsWith("/access/apps")) {
      return Response.json({ success: true, result: [{ id: "app-7", domain: "app-off.example.dev" }] });
    }
    return Response.json({ success: true, result: null });
  }) as typeof fetch;

  const r = await syncOAuth("app-off", { mode: "off" }, { accessFetch: impl } as unknown as never);

  expect(r.ok).toBe(true);
  // Off is not "do nothing": the Access app left from the previous rule keeps
  // challenging visitors until it is deleted.
  expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/access/apps/app-7"))).toBe(true);
  expect(getRecord("app-off")!.issues?.some((i) => i.source === "cloudflare")).toBeFalsy();
});

test("syncOAuth off never claims success when it could not even attempt the teardown", async () => {
  const { putRecord, getRecord, reloadRegistry } = await import("../registry/records.ts");
  const { updatePlatformSettings, reloadPlatformSettings } = await import("../api/platform-settings.ts");
  reloadRegistry();
  reloadPlatformSettings();
  putRecord({ name: "app-off-unconf", managedBy: "user", port: 11006, kind: "external", createdAt: "2026-08-10T00:00:00Z" });

  const impl = (async () => {
    throw new Error("must not call Cloudflare with no credentials or no domain");
  }) as unknown as typeof fetch;
  const deps = { accessFetch: impl } as unknown as never;

  // No credentials: the Access app at the edge is untouched and unknown, so
  // ok:true here is what makes the board report sign-in as off while
  // Cloudflare is still enforcing it.
  updatePlatformSettings({ publicDomain: "example.dev", secrets: { cfApiToken: undefined, cfZoneId: undefined } });
  const noCreds = await syncOAuth("app-off-unconf", { mode: "off" }, deps);
  expect(noCreds.ok).toBe(false);
  expect(noCreds.message).toContain("Cloudflare API token/zone not configured");
  expect(getRecord("app-off-unconf")!.issues!.some((i) => i.source === "cloudflare")).toBe(true);

  // Credentials but no bound domain: still no hostname to remove against.
  updatePlatformSettings({ publicDomain: null, secrets: { cfApiToken: "tok", cfZoneId: "z1" } });
  const noDomain = await syncOAuth("app-off-unconf", { mode: "off" }, deps);
  expect(noDomain.ok).toBe(false);
  expect(noDomain.message).toContain("No domain bound");
});

test("CfAccess.sync on an existing hostname updates the app and replaces its policy", async () => {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
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
  await cf.sync("myapp", "existing.example.dev", { mode: "emails", emails: ["m@x.dev"] });

  // No creates: the existing app and policy must be updated in place, not re-created.
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  const updateApp = calls.find((c) => c.method === "PUT" && c.url.endsWith("/access/apps/app-9"))!;
  expect(updateApp.body).toMatchObject({ domain: "existing.example.dev", type: "self_hosted" });
  const replacePolicy = calls.find((c) => c.method === "PUT" && c.url.endsWith("/access/apps/app-9/policies/pol-9"))!;
  expect(replacePolicy.body).toMatchObject({ decision: "allow", include: [{ email: { email: "m@x.dev" } }] });
});
