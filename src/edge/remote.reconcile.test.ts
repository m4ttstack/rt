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
