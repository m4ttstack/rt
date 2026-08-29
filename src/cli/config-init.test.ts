import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";
import { configInit } from "./config-init.ts";

function io() {
  const lines: string[] = [];
  return { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s), lines };
}

test("scaffolds a manifest inferring name and scripts", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfginit-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { serve: "bun run serve", build: "bun run build" } }));
  const a = io();
  expect(configInit(dir, a)).toBe(0);
  const m = JSON.parse(readFileSync(join(dir, "mattstack.deck.json"), "utf8"));
  expect(m.name).toBe(basename(dir));
  expect(m.commands.start).toBe("bun run serve");
  expect(m.commands.build).toBe("bun run build");
});

test("refuses to overwrite an existing manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfginit-"));
  writeFileSync(join(dir, "mattstack.deck.json"), "{}");
  const a = io();
  expect(configInit(dir, a)).toBe(1);
  expect(readFileSync(join(dir, "mattstack.deck.json"), "utf8")).toBe("{}");
});

test("still scaffolds with no package.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfginit-"));
  expect(configInit(dir, io())).toBe(0);
  expect(existsSync(join(dir, "mattstack.deck.json"))).toBe(true);
});
