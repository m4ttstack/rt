import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getRecord, putRecord, reloadRegistry } from "./records.ts";
import { assertSlimRowKeepsAFallback, migrateManagedDevShape } from "./migrate-dev-shape.ts";
import type { AppRecord } from "./records.ts";

beforeEach(() => {
  process.env.LOCAL_REGISTRY_PATH = join(mkdtempSync(join(tmpdir(), "reg-")), "registry.json");
  reloadRegistry();
});

function row(over: Partial<AppRecord>): AppRecord {
  return { name: "chat", managedBy: "rt", port: 11002, kind: "service", label: "com.mattstack.deck.chat", createdAt: "2026-08-31", ...over };
}
function repoWith(manifest: object): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify(manifest));
  return dir;
}

test("slims an old-shape bundle-ready row, and a second run is a no-op", () => {
  const dir = repoWith({ name: "chat", includeInBundle: true, dev: { start: "bun x" } });
  putRecord(row({ command: ["bun", "src/server/index.ts"], workingDirectory: dir, commands: { build: "b" } }));
  expect(migrateManagedDevShape().slimmed).toEqual(["chat"]);
  const r = getRecord("chat")!;
  expect(r.dev?.workingDirectory).toBe(dir);
  expect(r.command).toBeUndefined();
  expect(r.workingDirectory).toBeUndefined();
  expect(r.commands).toBeUndefined();
  expect(migrateManagedDevShape().slimmed).toEqual([]);
  const r2 = getRecord("chat")!;
  expect(r2.dev?.workingDirectory).toBe(dir);
  expect(r2.command).toBeUndefined();
  expect(r2.commands).toBeUndefined();
});

test("skips gitq-shaped (no includeInBundle) and fresh-install (no manifest) rows untouched", () => {
  const gitqDir = repoWith({ name: "gitq" });
  putRecord(row({ name: "gitq", command: ["/b/gitq", "board"], workingDirectory: gitqDir }));
  putRecord(row({ name: "console", command: ["/b/console"], workingDirectory: "/home/.mattstack/console" }));
  migrateManagedDevShape();
  expect(getRecord("gitq")?.command).toEqual(["/b/gitq", "board"]);
  expect(getRecord("gitq")?.dev).toBeUndefined();
  expect(getRecord("console")?.command).toEqual(["/b/console"]);
});

test("platform row: sourceDirectory moves to dev.workingDirectory, command survives", () => {
  putRecord(row({ name: "deck", managedBy: "deck", command: ["/app/deck", "serve"], sourceDirectory: "/repos/deck", commands: { deploy: "d" } }));
  migrateManagedDevShape();
  const r = getRecord("deck")!;
  expect(r.dev?.workingDirectory).toBe("/repos/deck");
  expect(r.sourceDirectory).toBeUndefined();
  expect(r.command).toEqual(["/app/deck", "serve"]);
  expect(r.commands).toBeUndefined();
});

test("user rows are untouched", () => {
  putRecord(row({ name: "mine", managedBy: "user", command: ["node", "s.js"], workingDirectory: "/x" }));
  migrateManagedDevShape();
  expect(getRecord("mine")?.command).toEqual(["node", "s.js"]);
  expect(getRecord("mine")?.dev).toBeUndefined();
});

test("skips a bundle-ready row with no dev.start and no installed bundle, leaving it fully untouched", () => {
  const dir = repoWith({ name: "chat", includeInBundle: true });
  putRecord(row({ command: ["bun", "src/server/index.ts"], workingDirectory: dir, commands: { build: "b" } }));
  const result = migrateManagedDevShape();
  expect(result.slimmed).toEqual([]);
  expect(result.skipped).toEqual(["chat"]);
  const r = getRecord("chat")!;
  expect(r.command).toEqual(["bun", "src/server/index.ts"]);
  expect(r.workingDirectory).toBe(dir);
  expect(r.commands).toEqual({ build: "b" });
  expect(r.dev).toBeUndefined();
});

test("uptime guard throws on a slim write without a dev link", () => {
  expect(() => assertSlimRowKeepsAFallback("chat", row({}))).toThrow(/refusing to slim/);
});
