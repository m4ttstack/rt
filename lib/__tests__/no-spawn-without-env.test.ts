import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { relative, resolve } from "path";

// Bun.spawn and Bun.spawnSync without an `env` hand the child the environment
// this process STARTED with, not process.env as it is now, so a variable the
// entry point deleted (MATTSTACK_FLAVOR, lib/flavor.ts) or a PATH the daemon
// resolved at boot never reaches the child. Every call passes env explicitly,
// usually childEnv() from lib/subprocess.ts.
const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN_ROOTS = ["commands", "lib", "cli.ts"];

function collectFiles(path: string): string[] {
  if (path.endsWith(".ts")) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name);
    if (entry.name === "node_modules" || entry.name === "__tests__") return [];
    if (entry.isDirectory()) return collectFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

/** The text between a call's opening paren and its matching close. */
function callArgs(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

export function spawnsWithoutEnv(source: string): number[] {
  const lines: number[] = [];
  const re = /Bun\.spawn(?:Sync)?\(/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const lineStart = source.lastIndexOf("\n", m.index) + 1;
    const before = source.slice(lineStart, m.index);
    if (before.includes("//") || /^\s*\*/.test(before)) continue;
    const args = callArgs(source, m.index + m[0].length - 1);
    if (!/(^|[\s{,])env\s*(:|,|\}|$)/m.test(args)) lines.push(source.slice(0, m.index).split("\n").length);
  }
  return lines;
}

test("the scanner flags a spawn without env and passes one with it", () => {
  expect(spawnsWithoutEnv(`Bun.spawn(["a"], { stdout: "pipe" });`)).toEqual([1]);
  expect(spawnsWithoutEnv(`Bun.spawnSync(["a"]);`)).toEqual([1]);
  expect(spawnsWithoutEnv(`Bun.spawn(["a"], { env: childEnv(), stdout: "pipe" });`)).toEqual([]);
  expect(spawnsWithoutEnv(`Bun.spawn(argv, { env, stdout: "ignore" });`)).toEqual([]);
  expect(spawnsWithoutEnv(`// Bun.spawn(argv) resolves PATH at start`)).toEqual([]);
});

test("every Bun.spawn/spawnSync under lib/, commands/ and cli.ts passes env", () => {
  const offenders = SCAN_ROOTS.flatMap((root) => collectFiles(resolve(ROOT, root))).flatMap((file) =>
    spawnsWithoutEnv(readFileSync(file, "utf8")).map((line) => `${relative(ROOT, file)}:${line}`),
  );
  expect(offenders).toEqual([]);
});
