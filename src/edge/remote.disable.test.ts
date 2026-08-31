import { expect, test, beforeEach } from "bun:test";
import { disableRemote } from "./remote.ts";
import { FakeRailwayDriver, FakeCfDns } from "../../test/fixture/remote.ts";
import { putRecord, getRecord, reloadRegistry, type AppRecord } from "../registry/records.ts";

const rec: AppRecord = { name: "site", managedBy: "user", port: 11010, kind: "service",
  command: ["bun", "run", "serve"], workingDirectory: "/tmp/site", label: "com.mattstack.deck.site", createdAt: "t",
  remote: { target: "railway", serviceId: "svc_1", customDomain: "site.m4tthew.dev", status: "live", cutover: "verified-first", txtName: "_railway-verify.site.m4tthew.dev" } };

beforeEach(() => { process.env.LOCAL_REGISTRY_PATH = `/tmp/deck-${crypto.randomUUID()}.json`; reloadRegistry(); putRecord(rec); });

test("flip-back deletes every remote object and clears the block", async () => {
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1"); rw.services.set("svc_1", { name: "deck-site" });
  const dns = new FakeCfDns(); dns.cname.set("site.m4tthew.dev", { target: "t", proxied: true }); dns.txt.set("_railway-verify.site.m4tthew.dev", "v");
  const r = await disableRemote("site", { railway: rw, dns });
  expect(r.status).toBe(200);
  expect(dns.cname.size).toBe(0);
  expect(dns.txt.size).toBe(0);
  expect(dns.calls).toContain("delTxt:_railway-verify.site.m4tthew.dev");
  expect(rw.calls).toContain("removeDomain:site.m4tthew.dev");
  expect(rw.calls).toContain("deleteService:svc_1");
  expect(getRecord("site")!.remote).toBeUndefined();
});

test("off on an app that is not remote is a no-op 200", async () => {
  putRecord({ ...rec, remote: undefined });
  const r = await disableRemote("site", { railway: new FakeRailwayDriver(), dns: new FakeCfDns() });
  expect(r.status).toBe(200);
});

test("grandfathered record with no stored txtName skips the TXT delete entirely", async () => {
  const { txtName: _drop, ...remoteNoTxt } = rec.remote!;
  putRecord({ ...rec, remote: remoteNoTxt });
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  dns.txt.set("_railway-verify.site.m4tthew.dev", "v"); // must survive: no name was stored to delete it by
  const r = await disableRemote("site", { railway: rw, dns });
  expect(r.status).toBe(200);
  expect(dns.calls.some(c => c.startsWith("delTxt:"))).toBe(false);
  expect(dns.txt.size).toBe(1);
});
