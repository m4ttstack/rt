// src/registry/records.test.ts
import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-registry-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");

const {
  listRecords, getRecord, putRecord, deleteRecord, reloadRegistry, addIssue, clearIssues,
} = await import("./records.ts");

afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
});

const rec = (name: string, managedBy = "user") => ({
  name, managedBy, port: 11000, kind: "service" as const,
  command: ["bun", "server.ts"], workingDirectory: "/tmp/x",
  label: `com.mattstack.deck.${name}`, createdAt: "2026-08-10T00:00:00Z",
});

test("empty registry lists nothing and survives a missing file", () => {
  expect(listRecords()).toEqual([]);
});

test("put/get/delete round-trips and persists to disk", () => {
  putRecord(rec("gitq", "rt"));
  expect(getRecord("gitq")!.managedBy).toBe("rt");
  reloadRegistry(); // force a re-read from disk
  expect(getRecord("gitq")!.port).toBe(11000);
  expect(deleteRecord("gitq")).toBe(true);
  expect(getRecord("gitq")).toBeUndefined();
  expect(deleteRecord("gitq")).toBe(false);
});

test("writes are atomic: a .tmp file never survives", () => {
  putRecord(rec("a"));
  expect(existsSync(process.env.LOCAL_REGISTRY_PATH! + ".tmp")).toBe(false);
  expect(JSON.parse(readFileSync(process.env.LOCAL_REGISTRY_PATH!, "utf8")).version).toBe(1);
});

test("issues accumulate per source and clear per source", () => {
  putRecord(rec("a"));
  addIssue("a", { source: "portless", message: "alias failed", at: "2026-08-10T00:00:00Z" });
  addIssue("a", { source: "launchd", message: "load failed", at: "2026-08-10T00:00:00Z" });
  expect(getRecord("a")!.issues).toHaveLength(2);
  clearIssues("a", "portless");
  expect(getRecord("a")!.issues).toHaveLength(1);
  expect(getRecord("a")!.issues![0]!.source).toBe("launchd");
});
