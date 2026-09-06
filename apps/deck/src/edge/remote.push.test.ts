import { expect, test, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
  expect(rw.configured.get("svc_1")).toEqual({
    buildCommand: undefined,
    startCommand: "bun run serve",
    port: 11010,
    variables: { API: "x", PORT: "11010" },
  });
  expect(rw.upCalls).toEqual([{ serviceId: "svc_1", cwd: "/tmp/site", token: "rw" }]);
});

test("refuses when an untracked .env would upload", async () => {
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1");
  const r = await pushRemote("site", deps(rw, { hasUntrackedEnv: () => true }));
  expect(r.status).toBe(400);
  expect(rw.calls).not.toContain("up:svc_1");
});

test("a linked/migrated row sends the checkout's dev.start and dev.build, not the record's cleared fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "linked-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({
    name: "site", dev: { start: "bun run dev", build: "bun run build" },
  }));
  putRecord({
    ...rec,
    command: undefined,
    workingDirectory: undefined,
    commands: undefined,
    dev: { workingDirectory: dir },
  });
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1");
  const r = await pushRemote("site", deps(rw));
  expect(r.status).toBe(200);
  expect(rw.configured.get("svc_1")).toEqual({
    buildCommand: "bun run build",
    startCommand: "bun run dev",
    port: 11010,
    variables: { API: "x", PORT: "11010" },
  });
  expect(rw.upCalls).toEqual([{ serviceId: "svc_1", cwd: dir, token: "rw" }]);
});

test("a row with no derivable start command fails cleanly instead of throwing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nostart-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "site" })); // no dev.start
  putRecord({
    ...rec,
    command: undefined,
    workingDirectory: undefined,
    commands: undefined,
    dev: { workingDirectory: dir },
  });
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1");
  const r = await pushRemote("site", deps(rw));
  expect(r.status).toBe(400);
  expect(rw.calls).toEqual([]);
});

test("build failure records a railway SyncIssue and the log", async () => {
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1"); rw.upResult = { ok: false, log: "nixpacks: no start" };
  const r = await pushRemote("site", deps(rw));
  expect(r.status).toBe(502);
  expect(getRecord("site")!.issues?.some(i => i.source === "railway")).toBe(true);
});
