import { expect, test, beforeEach } from "bun:test";
import { enableRemote, disableRemote } from "./remote.ts";
import { FakeRailwayDriver, FakeCfDns } from "../../test/fixture/remote.ts";
import { putRecord, getRecord, reloadRegistry, type AppRecord } from "../registry/records.ts";

const rec: AppRecord = { name: "site", managedBy: "user", port: 11010, kind: "service",
  command: ["bun", "run", "serve"], workingDirectory: "/tmp/site",
  label: "com.mattstack.deck.site", createdAt: "t" };

beforeEach(() => { process.env.LOCAL_REGISTRY_PATH = `/tmp/deck-${crypto.randomUUID()}.json`; reloadRegistry(); putRecord(rec); });

function deps(rw: FakeRailwayDriver, dns: FakeCfDns, over: Partial<any> = {}) {
  return { railway: rw, dns, token: "rw", projectId: "p", environmentId: "e",
    publicDomain: "m4tthew.dev", oauth: { mode: "emails" as const }, railwayConf: { projectId: "p", environmentId: "e" },
    hasRailwayToken: true, provenance: () => ({ sha: "s", dirty: false }), hasUntrackedEnv: () => false,
    pollBudgetMs: 600000, sleep: async () => {}, now: (() => { let t = 0; return () => (t += 60000); })(), ...over };
}

test("verified-first: TXT is written before the CNAME, CNAME is last, status live", async () => {
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  const r = await enableRemote("site", deps(rw, dns));
  expect(r.status).toBe(200);
  const txtIdx = dns.calls.findIndex(c => c.startsWith("txt:"));
  const cnameIdx = dns.calls.findIndex(c => c.startsWith("cname:"));
  expect(txtIdx).toBeGreaterThanOrEqual(0);
  expect(cnameIdx).toBeGreaterThan(txtIdx);
  expect(getRecord("site")!.remote!.status).toBe("live");
  expect(getRecord("site")!.remote!.cutover).toBe("verified-first");
  expect(getRecord("site")!.remote!.txtName).toBe("_railway-verify.site.m4tthew.dev");
});

test("enable then disable: the exact TXT written is the exact TXT deleted, txt map ends empty", async () => {
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  await enableRemote("site", deps(rw, dns));
  const written = getRecord("site")!.remote!.txtName!;
  expect(dns.txt.has(written)).toBe(true);
  await disableRemote("site", { railway: rw, dns });
  expect(dns.calls).toContain(`delTxt:${written}`);
  expect(dns.txt.size).toBe(0);
});

test("verifying transition sets nextPollAt to gate reconcileRemote out for the whole enable window", async () => {
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  const r = await enableRemote("site", deps(rw, dns, { now: () => 0 })); // fixed clock: verified on first check, no sleep
  expect(r.status).toBe(200);
  expect(Date.parse(getRecord("site")!.remote!.nextPollAt!)).toBe(600000); // 0 + pollBudgetMs
});

test("cname-first fallback: never verifies within budget, writes CNAME anyway", async () => {
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns(); // never setVerified
  const r = await enableRemote("site", deps(rw, dns));
  expect(r.status).toBe(200);
  expect(dns.cname.has("site.m4tthew.dev")).toBe(true);
  expect(getRecord("site")!.remote!.cutover).toBe("cname-first");
});

test("refuse-check failure aborts before any driver call", async () => {
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  const r = await enableRemote("site", deps(rw, dns, { oauth: { mode: "off" } }));
  expect(r.status).toBe(400);
  expect(rw.calls).toHaveLength(0);
  expect(dns.calls).toHaveLength(0);
});

test("idempotent resume reuses the existing service + domain (no re-add)", async () => {
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  await enableRemote("site", deps(rw, dns));
  const before = rw.calls.filter(c => c.startsWith("ensureDomain")).length;
  await enableRemote("site", deps(rw, dns)); // second run
  const after = rw.calls.filter(c => c.startsWith("ensureDomain")).length;
  expect(after).toBe(before + 1); // ensureCustomDomain called again but returns created:false; no delete-then-add
  expect(rw.calls).not.toContain("removeDomain:site.m4tthew.dev");
});
