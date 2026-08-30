// src/edge/cf-dns.test.ts
import { expect, test } from "bun:test";
import { FakeCfDns } from "../../test/fixture/remote.ts";

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
