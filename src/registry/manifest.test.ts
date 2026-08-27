import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readManifest } from "./manifest.ts";

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
