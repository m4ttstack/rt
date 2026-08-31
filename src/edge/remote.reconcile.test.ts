// src/edge/remote.reconcile.test.ts
import { expect, test, beforeEach } from "bun:test";
import { reconcileRemote } from "./remote.ts";
import { FakeRailwayDriver, FakeCfDns } from "../../test/fixture/remote.ts";
import { putRecord, getRecord, reloadRegistry, type AppRecord } from "../registry/records.ts";

// A real "verifying" record always carries cnameTarget: enableRemote stores it
// at that same transition (src/edge/remote.ts), so this fixture mirrors that
// invariant rather than a record that could never occur in production.
function verifyingRec(over: Partial<AppRecord> = {}): AppRecord {
  return { name: "site", managedBy: "user", port: 11010, kind: "service",
    command: ["bun","run","serve"], workingDirectory: "/tmp/site", label: "l", createdAt: "t",
    remote: { target: "railway", serviceId: "svc_1", customDomain: "site.m4tthew.dev", status: "verifying", cnameTarget: "kw1ig666.up.railway.app" }, ...over };
}
beforeEach(() => { process.env.LOCAL_REGISTRY_PATH = `/tmp/deck-${crypto.randomUUID()}.json`; reloadRegistry(); });

test("verified → writes CNAME, goes live", async () => {
  putRecord(verifyingRec());
  const rw = new FakeRailwayDriver(); rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  const dns = new FakeCfDns();
  await reconcileRemote({ railway: rw, dns, now: () => 1000 });
  expect(dns.cname.has("site.m4tthew.dev")).toBe(true);
  expect(getRecord("site")!.remote!.status).toBe("live");
});

test("not-yet-verified sets a future nextPollAt and does not busy-loop", async () => {
  putRecord(verifyingRec());
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  await reconcileRemote({ railway: rw, dns, now: () => 1000 });
  expect(getRecord("site")!.remote!.status).toBe("verifying");
  expect(Date.parse(getRecord("site")!.remote!.nextPollAt!)).toBeGreaterThan(1000);
});

test("a live record is skipped (no poll)", async () => {
  putRecord(verifyingRec({ remote: { target:"railway", serviceId:"svc_1", customDomain:"site.m4tthew.dev", status:"live" } }));
  const rw = new FakeRailwayDriver(); const spy: string[] = []; const orig = rw.domainStatus.bind(rw);
  rw.domainStatus = async (...a) => { spy.push("polled"); return orig(...a); };
  await reconcileRemote({ railway: rw, dns: new FakeCfDns(), now: () => 999999 });
  expect(spy).toHaveLength(0);
});

test("a verifying record with a future nextPollAt is skipped -- enable's window gates reconcile out", async () => {
  putRecord(verifyingRec({ remote: { target:"railway", serviceId:"svc_1", customDomain:"site.m4tthew.dev", status:"verifying", cnameTarget:"kw1ig666.up.railway.app", nextPollAt: new Date(2000).toISOString() } }));
  const rw = new FakeRailwayDriver(); rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  const spy: string[] = []; const origStatus = rw.domainStatus.bind(rw);
  rw.domainStatus = async (...a) => { spy.push("polled"); return origStatus(...a); };
  const dns = new FakeCfDns();
  await reconcileRemote({ railway: rw, dns, now: () => 1000 }); // 1000 < 2000, still inside enable's window
  expect(spy).toHaveLength(0);
  expect(dns.cname.has("site.m4tthew.dev")).toBe(false);
  expect(getRecord("site")!.remote!.status).toBe("verifying");
});

test("overlapping reconcile ticks do not double-drive the same record", async () => {
  putRecord(verifyingRec());
  const rw = new FakeRailwayDriver(); rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  let releaseFirstDomainStatus!: () => void;
  const gate = new Promise<void>((res) => { releaseFirstDomainStatus = res; });
  const origStatus = rw.domainStatus.bind(rw);
  let calls = 0;
  rw.domainStatus = async (...a) => { calls++; if (calls === 1) await gate; return origStatus(...a); };
  const dns = new FakeCfDns();
  const first = reconcileRemote({ railway: rw, dns, now: () => 1000 });
  const second = reconcileRemote({ railway: rw, dns, now: () => 1000 }); // fires while first is still in flight
  await second;
  releaseFirstDomainStatus();
  await first;
  expect(calls).toBe(1); // the second tick returned early instead of polling again
  expect(dns.calls.filter(c => c.startsWith("cname:"))).toHaveLength(1);
});
