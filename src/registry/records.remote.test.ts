import { expect, test, beforeEach } from "bun:test";
import { putRecord, getRecord, reloadRegistry, type AppRecord } from "./records.ts";

const base: AppRecord = {
  name: "site", managedBy: "user", port: 11010, kind: "service",
  command: ["bun", "run", "serve"], workingDirectory: "/tmp/site",
  label: "com.mattstack.deck.site", createdAt: new Date().toISOString(),
};

beforeEach(() => { process.env.LOCAL_REGISTRY_PATH = `/tmp/deck-test-${crypto.randomUUID()}.json`; reloadRegistry(); });

test("remote state round-trips through the registry", () => {
  putRecord({ ...base, remote: { target: "railway", serviceId: "svc_1", customDomain: "site.m4tthew.dev", status: "verifying" } });
  expect(getRecord("site")!.remote!.serviceId).toBe("svc_1");
  expect(getRecord("site")!.remote!.status).toBe("verifying");
});

test("a record without remote stays undefined (additive, no migration)", () => {
  putRecord(base);
  expect(getRecord("site")!.remote).toBeUndefined();
});
