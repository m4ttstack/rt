import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync as rf } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readManifest, ingestManifest, iconPathFor, removeIcon } from "./manifest.ts";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "manifest-"));
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>';

test("reads a valid manifest", () => {
  const dir = repo({
    "mattstack.json": JSON.stringify({ displayName: "Chat", description: "Group chat", icon: "./public/icon.svg" }),
    "public/icon.svg": SVG,
  });
  expect(readManifest(dir)).toEqual({ displayName: "Chat", description: "Group chat", icon: "./public/icon.svg" });
});

test("null when no manifest file", () => {
  expect(readManifest(mkdtempSync(join(tmpdir(), "empty-")))).toBeNull();
});

test("null on malformed JSON", () => {
  expect(readManifest(repo({ "mattstack.json": "{ not json" }))).toBeNull();
});

test("null when displayName is missing", () => {
  expect(readManifest(repo({ "mattstack.json": JSON.stringify({ icon: "./i.svg" }) }))).toBeNull();
});

test("null when icon is missing", () => {
  expect(readManifest(repo({ "mattstack.json": JSON.stringify({ displayName: "X" }) }))).toBeNull();
});

test("description is optional", () => {
  const dir = repo({ "mattstack.json": JSON.stringify({ displayName: "X", icon: "./i.svg" }) });
  expect(readManifest(dir)).toEqual({ displayName: "X", icon: "./i.svg" });
});

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "ingest-state-"));
  process.env.LOCAL_STATE_DIR = dir;
  process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
  process.env.HOME = dir;
  return dir;
}

test("ingest copies the icon and writes record metadata", async () => {
  isolate();
  const { putRecord, getRecord, reloadRegistry } = await import("./records.ts");
  reloadRegistry();
  const appDir = repo({
    "mattstack.json": JSON.stringify({ displayName: "Chat", description: "Group chat", icon: "./public/icon.svg" }),
    "public/icon.svg": SVG,
  });
  putRecord({ name: "chat", managedBy: "rt", port: 11002, kind: "service", workingDirectory: appDir, createdAt: "x" });
  ingestManifest("chat");
  const r = getRecord("chat")!;
  expect(r.displayName).toBe("Chat");
  expect(r.description).toBe("Group chat");
  expect(r.icon).toEqual({ ext: "svg" });
  expect(existsSync(iconPathFor("chat"))).toBe(true);
  expect(rf(iconPathFor("chat"), "utf8")).toContain("<svg");
});

test("ingest is a no-op skip when workingDirectory is undefined", async () => {
  isolate();
  const { putRecord, getRecord, reloadRegistry } = await import("./records.ts");
  reloadRegistry();
  putRecord({ name: "ext", managedBy: "rt", port: 5000, kind: "external", createdAt: "x" });
  expect(() => ingestManifest("ext")).not.toThrow();
  expect(getRecord("ext")!.displayName).toBeUndefined();
});

test("ingest skips a manifest whose icon is not svg or is too large", async () => {
  isolate();
  const { putRecord, getRecord, reloadRegistry } = await import("./records.ts");
  reloadRegistry();
  const appDir = repo({
    "mattstack.json": JSON.stringify({ displayName: "Bad", icon: "./big.svg" }),
    "big.svg": "x".repeat(70_000),
  });
  putRecord({ name: "bad", managedBy: "rt", port: 6000, kind: "service", workingDirectory: appDir, createdAt: "x" });
  ingestManifest("bad");
  const r = getRecord("bad")!;
  expect(r.displayName).toBeUndefined();
  expect(existsSync(iconPathFor("bad"))).toBe(false);
});

test("removeIcon deletes the stored file", async () => {
  isolate();
  const { putRecord, reloadRegistry } = await import("./records.ts");
  reloadRegistry();
  const appDir = repo({ "mattstack.json": JSON.stringify({ displayName: "C", icon: "./i.svg" }), "i.svg": SVG });
  putRecord({ name: "c", managedBy: "rt", port: 1, kind: "service", workingDirectory: appDir, createdAt: "x" });
  ingestManifest("c");
  expect(existsSync(iconPathFor("c"))).toBe(true);
  removeIcon("c");
  expect(existsSync(iconPathFor("c"))).toBe(false);
});
