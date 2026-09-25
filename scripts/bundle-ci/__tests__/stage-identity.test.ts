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

test("an app with no identity stages nothing and succeeds", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-cli-none-")), "identity-stage");
  const r = run(app({ name: "deck" }), out, "deck");
  expect(r.code).toBe(0);
  expect(r.out).toContain("no identity declared");
  expect(existsSync(out)).toBe(false);
});

test("an invalid identity fails the leg with the reason", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-cli-bad-")), "identity-stage");
  const r = run(app({ name: "chat", displayName: "Chat", icon: "./public/favicon.svg" }, "PNG"), out, "chat");
  expect(r.code).toBe(1);
  expect(r.out).toContain("not an svg");
});

test("missing arguments print usage", () => {
  expect(run().code).toBe(2);
});

test("the staging module imports nothing at runtime from lib/, which the build job never installs", () => {
  const src = readFileSync(join(REPO, "scripts", "lib", "app-identity.ts"), "utf8");
  expect(src).not.toMatch(/^import (?!type\b)[^;]*from "\.\.\/\.\.\/lib\//m);
});
