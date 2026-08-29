import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readDeckManifest, resolveServeShape } from "./deck-manifest.ts";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "deckman-"));
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

test("absent manifest is null (not an error)", () => {
  expect(readDeckManifest(repo({}))).toBeNull();
});

test("reads name, port, start and action commands", () => {
  const dir = repo({
    "mattstack.deck.json": JSON.stringify({
      name: "chat", displayName: "Chat", description: "rt chat viewer", icon: "public/icon.svg",
      port: 11002, commands: { start: "bun run serve", build: "bun run build", deploy: "bun run deploy" },
    }),
  });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(true);
  if (!r || !r.ok) throw new Error("unreachable");
  expect(r.manifest.name).toBe("chat");
  expect(r.manifest.port).toBe(11002);
  expect(r.manifest.commands).toEqual({ start: "bun run serve", build: "bun run build", deploy: "bun run deploy" });
  expect(r.manifest.displayName).toBe("Chat");
});

test("reads and normalizes altConfigs (commands.start -> start)", () => {
  const dir = repo({
    "mattstack.deck.json": JSON.stringify({
      name: "chat", commands: { start: "bun run serve" },
      altConfigs: { dev: { port: 5173, commands: { start: "bun run dev" } } },
    }),
  });
  const r = readDeckManifest(dir);
  if (!r || !r.ok) throw new Error("expected ok");
  expect(r.manifest.altConfigs).toEqual({ dev: { port: 5173, start: "bun run dev" } });
});

test("rejects an overlay that overrides anything but port/commands.start", () => {
  const dir = repo({
    "mattstack.deck.json": JSON.stringify({
      name: "chat", commands: { start: "s" },
      altConfigs: { dev: { commands: { deploy: "nope" } } },
    }),
  });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(false);
  if (!r || r.ok) throw new Error("expected error");
  expect(r.error).toContain("dev");
});

test("rejects a non-string command value", () => {
  const dir = repo({ "mattstack.deck.json": JSON.stringify({ name: "chat", commands: { start: 5 } }) });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(false);
});

test("rejects a bad name", () => {
  const dir = repo({ "mattstack.deck.json": JSON.stringify({ name: "Bad Name", commands: {} }) });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(false);
});

test("unparseable JSON is a loud error, not null", () => {
  const dir = repo({ "mattstack.deck.json": "{ not json" });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(false);
});

test("base serve shape wraps start in sh -c", () => {
  const shape = resolveServeShape({ name: "chat", port: 11002, commands: { start: "bun run serve" } });
  expect(shape).toEqual({ port: 11002, command: ["sh", "-c", "bun run serve"] });
});

test("overlay overrides port and start", () => {
  const shape = resolveServeShape(
    { name: "chat", port: 11002, commands: { start: "bun run serve" }, altConfigs: { dev: { port: 5173, start: "bun run dev" } } },
    "dev",
  );
  expect(shape).toEqual({ port: 5173, command: ["sh", "-c", "bun run dev"] });
});

test("overlay that omits a field inherits the base for it", () => {
  const shape = resolveServeShape(
    { name: "chat", port: 11002, commands: { start: "bun run serve" }, altConfigs: { hmr: { port: 5173 } } },
    "hmr",
  );
  expect(shape).toEqual({ port: 5173, command: ["sh", "-c", "bun run serve"] });
});

test("unknown alt throws", () => {
  expect(() => resolveServeShape({ name: "c", commands: { start: "s" } }, "nope")).toThrow();
});

test("no start command yields no argv (port-only app)", () => {
  expect(resolveServeShape({ name: "c", port: 4200, commands: {} })).toEqual({ port: 4200, command: undefined });
});

test("deck's own repo manifest parses", () => {
  const r = readDeckManifest(join(import.meta.dir, "..", ".."));
  expect(r?.ok).toBe(true);
  if (!r || !r.ok) throw new Error("unreachable");
  expect(r.manifest.name).toBe("deck");
  expect(r.manifest.commands.deploy).toBeDefined();
});
