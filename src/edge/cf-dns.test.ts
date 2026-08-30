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
