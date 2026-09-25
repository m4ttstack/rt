/**
 * Source-guard tests: everything here reads source as text, so --changed
 * cannot select it, and the no-* prefix is what puts it in the always-run
 * set.
 */

import { test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

test("log writers resolve the log dir at call time, not at module load", () => {
  // Source-guard: a writer that binds its log dir to a module-level const is
  // invisible until it silently pollutes the real tree, so pin it here.
  for (const file of ["../daemon-logger.ts", "../cli-logger.ts"]) {
    const src = readFileSync(join(import.meta.dir, file), "utf8");
    expect(src).toContain("logsDir()");
    expect(src).not.toMatch(/^const LOG_DIR\s*=/m);
  }
});

/** Walk .ts sources (skipping tests, node_modules, dist) under a root. */
const walkSources = (root: string, visit: (file: string, src: string) => void) => {
  const st = statSync(root);
  if (!st.isDirectory()) {
    visit(root, readFileSync(root, "utf8"));
    return;
  }
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__" || entry === "dist") continue;
      walkSources(full, visit);
      continue;
    }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    if (entry.endsWith(".test.ts")) continue;
    if (full.endsWith("/rt-paths.ts")) continue; // the one allowed home
    visit(full, readFileSync(full, "utf8"));
  }
};

test("no code in lib/ reconstructs <rtDir>/<repoName> by hand", () => {
  const libDir = join(import.meta.dir, "..");
  // The old per-repo-at-root shapes. Per-repo paths MUST go through
  // repoDataDir(); app-level joins use string literals and are not matched.
  const antipatterns = [
    /join\(\s*RT_DIR\s*,\s*[a-zA-Z_$]/,                       // join(RT_DIR, repoName...
    /join\(\s*homedir\(\)\s*,\s*"\.rt"\s*,\s*[a-zA-Z_$]/,     // legacy join(homedir(), <dir>, repoName)
    /["']\.rt["']\s*,\s*repoName/,                            // legacy literal, repoName
  ];
  const offenders: string[] = [];
  walkSources(libDir, (file, src) => {
    src.split("\n").forEach((line, i) => {
      if (antipatterns.some((re) => re.test(line))) {
        offenders.push(`${file}:${i + 1}  ${line.trim()}`);
      }
    });
  });
  expect(offenders, `Per-repo paths must use repoDataDir() from rt-paths.ts:\n${offenders.join("\n")}`).toEqual([]);
});

test("no source builds a legacy .rt path outside rt-paths.ts", () => {
  // The ~/.rt to ~/.mattstack/rt move is complete: nothing may
  // reference the legacy tree except rt-paths.ts itself (which owns the
  // migration + canary). Catches both quoted literals (".rt") and path-like
  // occurrences in strings/comments (~/.rt/..., $HOME/.rt/...).
  const repoRoot = join(import.meta.dir, "..", "..");
  const roots = [
    join(repoRoot, "lib"),
    join(repoRoot, "commands"),
    join(repoRoot, "cli.ts"),
    join(repoRoot, "packages", "rt-client", "src"),
  ];
  const antipatterns = [
    /["'`]\.rt["'`]/,        // the quoted literal ".rt"
    /\/\.rt(\/|\b)/,         // a /.rt path segment (~/.rt/..., $HOME/.rt)
  ];
  const offenders: string[] = [];
  for (const root of roots) {
    walkSources(root, (file, src) => {
      src.split("\n").forEach((line, i) => {
        if (antipatterns.some((re) => re.test(line))) {
          offenders.push(`${file}:${i + 1}  ${line.trim()}`);
        }
      });
    });
  }
  expect(
    offenders,
    `Legacy .rt paths must go through rt-paths.ts (rtDir() et al.):\n${offenders.join("\n")}`,
  ).toEqual([]);
});
