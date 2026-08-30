import { expect, test } from "bun:test";
import { FakeRailwayDriver } from "../../test/fixture/remote.ts";

test("ensureService is idempotent by name (reuse, never re-create)", async () => {
  const rw = new FakeRailwayDriver();
  const a = await rw.ensureService("deck-site", { projectId: "p", environmentId: "e" });
  const b = await rw.ensureService("deck-site", { projectId: "p", environmentId: "e" });
  expect(a.serviceId).toBe(b.serviceId);
  expect(a.created).toBe(true);
  expect(b.created).toBe(false);
});

test("domainStatus is scriptable and ensureCustomDomain returns TXT + CNAME target", async () => {
  const rw = new FakeRailwayDriver();
  const { serviceId } = await rw.ensureService("deck-site", { projectId: "p", environmentId: "e" });
  const d = await rw.ensureCustomDomain(serviceId, "site.m4tthew.dev", 11010);
  expect(d.txtName).toContain("site.m4tthew.dev");
  expect(d.cnameTarget).toMatch(/\.up\.railway\.app$/);
  rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  expect(await rw.domainStatus(serviceId, "site.m4tthew.dev")).toEqual({ verified: true, proxyDetected: true });
});
