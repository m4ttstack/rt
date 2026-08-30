import { expect, test, beforeEach } from "bun:test";
import { pushRemote } from "./remote.ts";
import { FakeRailwayDriver } from "../../test/fixture/remote.ts";
import { putRecord, getRecord, reloadRegistry, type AppRecord } from "../registry/records.ts";

const rec: AppRecord = { name: "site", managedBy: "user", port: 11010, kind: "service",
  command: ["bun", "run", "serve"], workingDirectory: "/tmp/site", env: { API: "x" },
  label: "com.mattstack.deck.site", createdAt: "t",
  remote: { target: "railway", serviceId: "svc_1", customDomain: "site.m4tthew.dev", status: "live" } };

beforeEach(() => { process.env.LOCAL_REGISTRY_PATH = `/tmp/deck-${crypto.randomUUID()}.json`; reloadRegistry(); putRecord(rec); });

function deps(rw: FakeRailwayDriver, over: Partial<any> = {}) {
  return { railway: rw, token: "rw", provenance: () => ({ sha: "abc123", dirty: true }), hasUntrackedEnv: () => false, ...over };
}

test("push configures build/start/PORT/env, uploads, records provenance", async () => {
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1");
  const r = await pushRemote("site", deps(rw));
  expect(r.status).toBe(200);
  expect(rw.calls).toContain("configure:svc_1");
  expect(rw.calls).toContain("up:svc_1");
  expect(getRecord("site")!.remote!.lastPush).toEqual({ sha: "abc123", dirty: true, at: expect.any(String) });
});

test("refuses when an untracked .env would upload", async () => {
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1");
  const r = await pushRemote("site", deps(rw, { hasUntrackedEnv: () => true }));
  expect(r.status).toBe(400);
  expect(rw.calls).not.toContain("up:svc_1");
});

test("build failure records a railway SyncIssue and the log", async () => {
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1"); rw.upResult = { ok: false, log: "nixpacks: no start" };
  const r = await pushRemote("site", deps(rw));
  expect(r.status).toBe(502);
  expect(getRecord("site")!.issues?.some(i => i.source === "railway")).toBe(true);
});
