import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO = join(import.meta.dir, "..", "..", "..");
const CLI = join(REPO, "scripts", "bundle-ci", "stage-identity.ts");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

function run(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { cwd: REPO });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

function app(manifest: object, icon?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "stage-cli-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify(manifest));
  if (icon !== undefined) {
    mkdirSync(join(dir, "public"), { recursive: true });
    writeFileSync(join(dir, "public", "favicon.svg"), icon);
  }
  return dir;
}

test("stages a declared identity", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-cli-out-")), "identity-stage");
  const r = run(app({ name: "chat", displayName: "Chat", icon: "./public/favicon.svg" }, SVG), out, "chat");
  expect(r.code).toBe(0);
  expect(r.out).toContain("staged identity for chat");
  expect(readFileSync(join(out, "public", "favicon.svg"), "utf8")).toBe(SVG);
});

function lock(rows: object[]): string {
  const p = join(mkdtempSync(join(tmpdir(), "stage-cli-lock-")), "deps.lock");
  writeFileSync(p, JSON.stringify({ schema: 1, arch: "arm64", tools: rows }));
  return p;
}

test("an app deps.lock does not serve, with no identity, stages nothing and succeeds", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-cli-none-")), "identity-stage");
  const r = run(app({ name: "deck" }), out, "deck", "--lock", lock([{ name: "deck", status: "bundled" }]));
  expect(r.code).toBe(0);
  expect(r.out).toContain("no identity declared");
  expect(existsSync(out)).toBe(false);
});

test("a served app whose manifest declares no identity fails the leg before anything is released", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-cli-served-")), "identity-stage");
  const r = run(app({ name: "chat" }), out, "chat", "--lock", lock([{ name: "chat", status: "bundled", serve: { port: 11002, args: [] } }]));
  expect(r.code).toBe(1);
  expect(r.out).toContain("chat is served in deps.lock but");
  expect(r.out).toContain("declares no displayName and icon");
});

test("the default lock is the repo's own deps.lock", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-cli-default-")), "identity-stage");
  const r = run(app({ name: "board" }), out, "board");
  expect(r.code).toBe(1);
  expect(r.out).toContain("board is served in deps.lock");
});

test("an invalid identity fails the leg with the reason", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-cli-bad-")), "identity-stage");
  const r = run(app({ name: "chat", displayName: "Chat", icon: "./public/favicon.svg" }, "PNG"), out, "chat");
  expect(r.code).toBe(1);
  expect(r.out).toContain("not an svg");
});

test("missing arguments or a --lock with no value print usage", () => {
  expect(run().code).toBe(2);
  expect(run("a", "b", "chat", "--lock").code).toBe(2);
});

// The bundle-apps build job runs these two files with no install of this
// repo, so a runtime import may reach only node builtins and each other.
test("the staging path imports only node builtins and its sibling at runtime", () => {
  for (const file of [join("scripts", "bundle-ci", "stage-identity.ts"), join("scripts", "lib", "app-identity.ts")]) {
    const src = readFileSync(join(REPO, file), "utf8");
    const staticSpecs = [...src.matchAll(/^import (?!type\b)[^;]*?from "([^"]+)"/gm)].map((m) => m[1]);
    const topLevelDynamic = (src.split("\nif (import.meta.main)")[0] ?? "").match(/\bimport\(/g) ?? [];
    for (const spec of staticSpecs) {
      expect([file, spec]).toEqual([file, expect.stringMatching(/^(fs|path|os|node:[a-z/]+|\.\.\/lib\/app-identity\.ts)$/)]);
    }
    expect([file, topLevelDynamic.length]).toEqual([file, 0]);
  }
});
