import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tier 1 conformance gate: NOTHING SHIPPED FROM `src/` MAY REACH FOR A NODE
 * BUILT-IN OR FOR `process`.
 *
 * WHY THIS FILE EXISTS. The kit's tsconfig declares `"types": ["node"]`
 * globally, because `scripts/` and `test/` genuinely use node APIs and a
 * src-vs-scripts config split would buy duplication and nothing else.
 *
 * It was originally forced by a stronger reason that no longer applies: while
 * soribashi was consumed via `file:`, @soribashi/factory came in as TypeScript
 * SOURCE (soribashi packages set `"types": "./src/index.ts"`), so `tsc`
 * type-checked factory's own `.ts` files as part of any program covering
 * `src/`, and four of them read `process.env.NODE_ENV` — `skipLibCheck` did not
 * help (it skips `.d.ts`; those were `.ts`) and no tsconfig split could, since
 * the errors came from inside the dependency. The published `@soribashi/core`
 * ships compiled `.d.ts`, so that pressure is gone.
 *
 * The gate below is unaffected either way: node types are still declared
 * globally, so the type system still cannot catch a node import in `src/`.
 *
 * The cost of that fix is this file. Before it, `import { readFileSync } from
 * "node:fs"` inside src/theme.ts — or a stray `process.env` in a recipe —
 * type-checked cleanly and only exploded at runtime in a browser, where the
 * symptom is a bundler error or an undefined global in a consumer's app, far
 * from the line that caused it. `src/` is browser code; the type system can no
 * longer say so, so this gate says it mechanically instead.
 *
 * Deliberately dumb and grep-like, same spirit as the two CSS gates: comments
 * are blanked (so a doc comment may discuss `process.env` freely), then two
 * regex sweeps run. It is not a module resolver and does not need to be.
 *
 * SCOPE: every `.ts`/`.tsx` file under `src/`, EXCLUDING test files
 * (`*.test.ts`, `*.test.tsx`, `*.visual.test.tsx`). A node-tier test colocated
 * with a recipe legitimately reads the filesystem; shipped source never does.
 * `scripts/` and `test/` are out of scope entirely — they are node programs by
 * design, which is the whole distinction being drawn.
 */

interface Violation {
  path: string;
  line: number;
  token: string;
  kind: "builtin-import" | "process";
}

/**
 * Node's built-in module names as they appear WITHOUT the `node:` prefix. The
 * `node:`-prefixed form is caught generically by NODE_PREFIXED_IMPORT below, so
 * this list only has to cover the bare aliases. Not exhaustive across every
 * node release, and does not need to be: a bare specifier that is not on this
 * list resolves to a real npm package, which is a dependency question rather
 * than a browser-safety one.
 */
const BARE_BUILTINS = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
].sort((a, b) => b.length - a.length);

/** `from "node:fs"` / `import "node:fs"` / `import("node:fs")`, either quote. */
const NODE_PREFIXED_IMPORT = /["'](node:[a-z_/]+)["']/g;

/** `from "fs"` / `import("path")` etc. for the bare aliases above. */
const BARE_BUILTIN_IMPORT = new RegExp(
  `(?:from|import)\\s*\\(?\\s*["'](${BARE_BUILTINS.join("|")})["']`,
  "g",
);

/**
 * A bare `process.` member access. `\b` in front keeps `childProcess.spawn` and
 * `theProcess.kill` out of it; the gate is about the AMBIENT global that
 * `"types": ["node"]` re-introduced, not about the word.
 */
const PROCESS_GLOBAL = /(?<![.\w$])process\s*\./g;

/**
 * Blanks `/* ... *\/` and `// ...` with equal-length whitespace, newlines
 * preserved, so line numbers stay accurate and prose may discuss the very
 * things this gate forbids (as the header above does).
 */
function stripCommentsPreservingLines(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

export function scanSourceFile(source: string, path: string): Violation[] {
  const scanned = stripCommentsPreservingLines(source);
  const found: Array<{ index: number; token: string; kind: Violation["kind"] }> = [];

  for (const m of scanned.matchAll(NODE_PREFIXED_IMPORT)) {
    found.push({ index: m.index, token: m[1]!, kind: "builtin-import" });
  }
  for (const m of scanned.matchAll(BARE_BUILTIN_IMPORT)) {
    found.push({ index: m.index, token: m[1]!, kind: "builtin-import" });
  }
  for (const m of scanned.matchAll(PROCESS_GLOBAL)) {
    found.push({ index: m.index, token: "process.", kind: "process" });
  }

  found.sort((a, b) => a.index - b.index);
  return found.map((f) => ({
    path,
    line: scanned.slice(0, f.index).split("\n").length,
    token: f.token,
    kind: f.kind,
  }));
}

function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return "";
  return `${violations
    .map((v) =>
      v.kind === "process"
        ? `${v.path}:${v.line}: reads the node \`process\` global`
        : `${v.path}:${v.line}: imports the node built-in "${v.token}"`,
    )
    .join("\n")}\n\nsrc/ is browser code. tsconfig declares "types": ["node"] only because @soribashi/factory is consumed as TypeScript source and reads process.env, so the type system can no longer catch this — move the code to scripts/ or test/, or find a browser API that does the job.`;
}

// ---------------------------------------------------------------------------
// Part 1: the scanner, against inline fixture strings.
// ---------------------------------------------------------------------------

describe("scanSourceFile", () => {
  it("passes a file with only browser-safe imports", () => {
    const src = [
      'import type { ReactNode } from "react";',
      'import { defineComponent } from "../../builders.ts";',
      "export const x = 1;",
    ].join("\n");
    expect(scanSourceFile(src, "fixture.ts")).toEqual([]);
  });

  it("flags a node:-prefixed import, reporting path/line/token", () => {
    const src = ['import { readFileSync } from "node:fs";', "export const x = 1;"].join("\n");
    expect(scanSourceFile(src, "fixture.ts")).toEqual([
      { path: "fixture.ts", line: 1, token: "node:fs", kind: "builtin-import" },
    ]);
  });

  it("flags a bare built-in import in either quote style", () => {
    const src = ['import { join } from "path";', "import { homedir } from 'os';"].join("\n");
    expect(scanSourceFile(src, "fixture.ts").map((v) => v.token)).toEqual(["path", "os"]);
  });

  it("flags a dynamic import of a built-in", () => {
    const src = 'const fs = await import("node:fs/promises");';
    expect(scanSourceFile(src, "fixture.ts").map((v) => v.token)).toEqual(["node:fs/promises"]);
  });

  it("flags a bare `process.` read", () => {
    const src = ["export const dev = process.env.NODE_ENV !== \"production\";"].join("\n");
    expect(scanSourceFile(src, "fixture.ts")).toEqual([
      { path: "fixture.ts", line: 1, token: "process.", kind: "process" },
    ]);
  });

  it("does not flag a member named process on some other object", () => {
    const src = ["childProcess.spawn(cmd);", "this.process.tick();"].join("\n");
    expect(scanSourceFile(src, "fixture.ts")).toEqual([]);
  });

  it("does not flag a bare specifier that merely CONTAINS a built-in name", () => {
    // "node:fs" vs the npm packages "pathe"/"crypto-js"/"@types/node".
    const src = [
      'import { resolve } from "pathe";',
      'import sha from "crypto-js";',
      'import x from "process-nextick-args";',
    ].join("\n");
    expect(scanSourceFile(src, "fixture.ts")).toEqual([]);
  });

  it("ignores anything inside comments, block or line", () => {
    const src = [
      "/**",
      ' * Never do: import { readFileSync } from "node:fs";',
      " * and never read process.env here.",
      " */",
      '// import { join } from "path";',
      "export const x = 1;",
    ].join("\n");
    expect(scanSourceFile(src, "fixture.ts")).toEqual([]);
  });

  it("reports several violations in source order with correct line numbers", () => {
    const src = [
      'import { readFileSync } from "node:fs";',
      "",
      "export const dev = process.env.DEV;",
    ].join("\n");
    expect(scanSourceFile(src, "fixture.ts")).toEqual([
      { path: "fixture.ts", line: 1, token: "node:fs", kind: "builtin-import" },
      { path: "fixture.ts", line: 3, token: "process.", kind: "process" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Part 2: the real sweep over shipped src/.
// ---------------------------------------------------------------------------

const SRC_DIR = join(import.meta.dirname, "..", "src");

const TEST_FILE = /\.(test|visual\.test)\.tsx?$/;

function findShippedSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findShippedSourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !TEST_FILE.test(entry)) {
      out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

describe("no node built-ins: shipped src/", () => {
  const files = findShippedSourceFiles(SRC_DIR);

  it("finds shipped source to sweep (guards against a silently empty run)", () => {
    // A real floor, unlike the recipe gates': src/ has never been empty — it
    // has carried theme.ts, intent-resolver.ts and builders.ts since Task 3.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(SRC_DIR, f), f] as const))(
    "%s imports no node built-in and reads no process global",
    (_label, file) => {
      const violations = scanSourceFile(readFileSync(file, "utf8"), relative(SRC_DIR, file));
      expect(violations, formatViolations(violations)).toEqual([]);
    },
  );
});
