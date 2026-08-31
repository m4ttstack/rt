// src/edge/cf-dns.test.ts
import { expect, test } from "bun:test";
import { FakeCfDns } from "../../test/fixture/remote.ts";
import { CfDnsApi } from "./cf-dns.ts";

test("proxied cname + txt write and delete leave no host records", async () => {
  const dns = new FakeCfDns();
  await dns.writeTxt("_railway.site.m4tthew.dev", "rw-verify");
  await dns.writeProxiedCname("site.m4tthew.dev", "site.m4tthew.dev.up.railway.app");
  expect(dns.cname.get("site.m4tthew.dev")).toEqual({ target: "site.m4tthew.dev.up.railway.app", proxied: true });
  await dns.deleteHostRecords("site.m4tthew.dev");
  await dns.deleteTxt("_railway.site.m4tthew.dev");
  expect(dns.cname.size).toBe(0);
  expect(dns.txt.size).toBe(0);
});

test("zone ssl mode and token scope are readable", async () => {
  const dns = new FakeCfDns();
  dns.ssl = "full"; dns.canEdit = true;
  expect(await dns.zoneSslMode()).toBe("full");
  expect(await dns.tokenCanEditDns()).toBe(true);
});

// An Access-scoped token verifies as active but still fails a real
// dns_records read; a Zone.DNS token's dns_records read succeeds. Only the
// DNS read itself distinguishes the two -- /user/tokens/verify does not.
test("tokenCanEditDns probes a real dns_records read, not just token status", async () => {
  const accessOnlyFetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/dns_records")) {
      return Response.json({ success: false, errors: [{ code: 9109, message: "unauthorized" }] }, { status: 403 });
    }
    return Response.json({ success: true, result: { id: "tok-1", status: "active" } });
  }) as typeof fetch;
  const accessOnlyDns = new CfDnsApi({ zoneId: "z1", token: "access-tok", fetchImpl: accessOnlyFetch });
  expect(await accessOnlyDns.tokenCanEditDns()).toBe(false);

  const zoneDnsFetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/dns_records")) {
      return Response.json({ success: true, result: [] });
    }
    return Response.json({ success: true, result: { id: "tok-2", status: "active" } });
  }) as typeof fetch;
  const zoneDnsDns = new CfDnsApi({ zoneId: "z1", token: "zone-dns-tok", fetchImpl: zoneDnsFetch });
  expect(await zoneDnsDns.tokenCanEditDns()).toBe(true);
});

// Cloudflare rejects a CNAME create when a record with that name exists
// (error 81053), so the write must find and PATCH the existing record.
test("writeProxiedCname updates an existing record instead of creating a duplicate", async () => {
  const calls: { method: string; url: string; body: any }[] = [];
  const existing = { id: "rec-1", type: "CNAME", name: "*.example.dev", content: "old.cfargotunnel.com", proxied: true };
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: String(url), body });
    if (method === "GET") return Response.json({ success: true, result: [existing] });
    if (method === "POST") return Response.json({ success: false, errors: [{ code: 81053, message: "already exists" }] });
    return Response.json({ success: true, result: { ...existing, content: body.content } });
  }) as typeof fetch;
  const dns = new CfDnsApi({ zoneId: "z1", token: "t", fetchImpl });
  await dns.writeProxiedCname("*.example.dev", "new.cfargotunnel.com");
  const write = calls.find((c) => c.method !== "GET")!;
  expect(write.method).toBe("PATCH");
  expect(write.url).toContain("/dns_records/rec-1");
  expect(write.body).toEqual({ type: "CNAME", name: "*.example.dev", content: "new.cfargotunnel.com", proxied: true });
});

test("writeProxiedCname creates when no record exists", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(method);
    if (method === "GET") return Response.json({ success: true, result: [] });
    return Response.json({ success: true, result: { id: "rec-2" } });
  }) as typeof fetch;
  const dns = new CfDnsApi({ zoneId: "z1", token: "t", fetchImpl });
  await dns.writeProxiedCname("*.example.dev", "u.cfargotunnel.com");
  expect(calls).toEqual(["GET", "POST"]);
});

test("cnameTarget reads the existing record's content + proxied state, null when absent", async () => {
  // URLSearchParams leaves `*` unencoded, so match on the parsed param, never on a hand-encoded string.
  const fetchImpl = (async (url: string | URL | Request) =>
    Response.json({ success: true, result: new URL(String(url)).searchParams.get("name") === "*.example.dev" ? [{ id: "r", type: "CNAME", name: "*.example.dev", content: "u.cfargotunnel.com", proxied: true }] : [] })
  ) as typeof fetch;
  const dns = new CfDnsApi({ zoneId: "z1", token: "t", fetchImpl });
  expect(await dns.cnameTarget("*.example.dev")).toEqual({ target: "u.cfargotunnel.com", proxied: true });
  expect(await dns.cnameTarget("*.other.dev")).toBeNull();
});

test("FakeCfDns mirrors upsert + cnameTarget", async () => {
  const dns = new FakeCfDns();
  await dns.writeProxiedCname("*.e.dev", "a.cfargotunnel.com");
  await dns.writeProxiedCname("*.e.dev", "b.cfargotunnel.com");
  expect(dns.cname.size).toBe(1);
  expect(await dns.cnameTarget("*.e.dev")).toEqual({ target: "b.cfargotunnel.com", proxied: true });
  expect(await dns.cnameTarget("*.none.dev")).toBeNull();
});
