/**
 * Decides what the unit shards run for one CI event and prints the answer
 * for checks.yml. Usage:
 *   bun scripts/ci/test-scope.ts             writes mode=, dirs=, always= to $GITHUB_OUTPUT
 *   bun scripts/ci/test-scope.ts --explain   prints the decision and its reason only
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { basename, dirname, extname, join, relative, resolve } from "path";

export const ROOT = resolve(import.meta.dirname, "..", "..");

export type Mode = "full" | "changed" | "skip";
export type Decision = { mode: Mode; reason: string };
export type ScopeInput = {
  event: string;
  changed: string[];
  sources: Map<string, string>;
  preloadImports: Set<string>;
};

const PRELOAD = "test-setup.ts";

export function unitDirs(pkg: { scripts: Record<string, string> } = readPackage()): string[] {
  const script = pkg.scripts.test ?? "";
  const dirs = /^bun test ([\w./][\w./-]*(?: [\w./][\w./-]*)*)$/.exec(script)?.[1]?.trim();
  if (!dirs) throw new Error(`package.json test script is not a bare bun test run over directories: ${script}`);
  // A leading "./" scopes bun test's substring filter to that directory (a bare
  // name matches anywhere in the tree); strip it so callers keep working with
  // plain relative paths.
  return dirs.split(/\s+/).map((dir) => dir.replace(/^\.\//, ""));
}

export function alwaysRun(): string[] {
  const files = unitDirs().flatMap((dir) => testFiles(join(ROOT, dir)));
  return files.filter((f) => /^no-.*\.test\.tsx?$/.test(basename(f))).sort();
}

function readPackage() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
}

function isDocs(f: string): boolean {
  return f.startsWith("docs/") || (f.endsWith(".md") && !f.startsWith("skills/"));
}

function isSwift(f: string): boolean {
  return (
    extname(f) === ".swift" &&
    f.startsWith("rt-tray/") &&
    !f.startsWith("rt-tray/Tests/stub-rt/") &&
    !f.startsWith("rt-tray/vm/run/helpers/")
  );
}

function isFixture(f: string): boolean {
  return /(^|\/)(fixtures|__fixtures__)\//.test(f);
}

function readBy(sources: Map<string, string>, f: string): string | undefined {
  const name = basename(f);
  for (const [source, text] of sources) {
    if (text.includes(f) || text.includes(name)) return source;
  }
  return undefined;
}

function invisible(input: ScopeInput, f: string): string | undefined {
  if (extname(f) !== ".ts") return "not typescript";
  if (f === PRELOAD) return "the preload";
  if (input.preloadImports.has(f)) return "imported by the preload";
  if (isFixture(f)) return "a fixture";
  if (f.startsWith("scripts/ci/")) return "the scope script";
  return undefined;
}

export function decide(input: ScopeInput): Decision {
  if (input.event !== "pull_request") return { mode: "full", reason: `${input.event} is not a pull request` };
  if (input.changed.length === 0) return { mode: "skip", reason: "no changed files" };

  const skippable = input.changed.every((f) => (isDocs(f) || isSwift(f)) && !isFixture(f));
  if (skippable) {
    const read = input.changed.map((f) => [f, readBy(input.sources, f)] as const).find(([, by]) => by);
    if (!read) return { mode: "skip", reason: "only docs or swift, none of it read by a unit test" };
    return { mode: "full", reason: `${read[0]} is read by ${read[1]}` };
  }

  for (const f of input.changed) {
    const why = invisible(input, f);
    if (why) return { mode: "full", reason: `${f} is ${why}, which --changed cannot see` };
  }
  return { mode: "changed", reason: "typescript only; --changed selects the importers" };
}

// The unit test sources: every test file under the unit directories plus
// the preload, and the relative imports both reach. String presence in
// this text is what "a test reads this file" means. scripts/ci is left
// out so this script's own test, which names files on purpose, never
// widens the read set.
export function collectSources(): { sources: Map<string, string>; preloadImports: Set<string> } {
  const preloadImports = walk([PRELOAD]);
  preloadImports.delete(PRELOAD);
  const roots = [PRELOAD];
  for (const dir of unitDirs()) roots.push(...testFiles(join(ROOT, dir)));
  const sources = new Map<string, string>();
  for (const rel of walk(roots)) sources.set(rel, readFileSync(join(ROOT, rel), "utf8"));
  return { sources, preloadImports };
}

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

// Every file the roots reach through relative imports, roots included.
// Only TypeScript is scanned; a JSON or shell file that a test imports is
// kept as text but has no imports of its own. The shebang some command
// modules start with is not syntax the transpiler accepts.
function walk(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    seen.add(rel);
    if (!/\.tsx?$/.test(rel)) continue;
    const text = readFileSync(abs, "utf8").replace(/^#!.*/, "");
    const transpiler = rel.endsWith(".tsx") ? transpilers.tsx : transpilers.ts;
    for (const imp of transpiler.scanImports(text)) {
      if (!imp.path.startsWith(".")) continue;
      const target = relative(ROOT, resolve(dirname(abs), imp.path));
      const file = existsSync(join(ROOT, target)) && statSync(join(ROOT, target)).isFile() ? target : `${target}.ts`;
      if (existsSync(join(ROOT, file))) queue.push(file);
    }
  }
  return seen;
}

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const abs = join(dir, entry);
    if (relative(ROOT, abs) === "scripts/ci") continue;
    if (statSync(abs).isDirectory()) out.push(...testFiles(abs));
    else if (/\.test\.tsx?$/.test(entry)) out.push(relative(ROOT, abs));
  }
  return out;
}

export const CHANGED_ARGS = ["diff", "--no-renames", "--name-only", "HEAD^1", "HEAD"];

function changedFiles(): string[] {
  const diff = spawnSync("git", CHANGED_ARGS, { cwd: ROOT, encoding: "utf8" });
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);
  return diff.stdout.split("\n").filter(Boolean);
}

if (import.meta.main) {
  const event = process.env.EVENT_NAME ?? process.env.GITHUB_EVENT_NAME ?? "push";
  const changed = event === "pull_request" ? changedFiles() : [];
  const scope = event === "pull_request" ? collectSources() : { sources: new Map<string, string>(), preloadImports: new Set<string>() };
  const decision = decide({ event, changed, ...scope });
  const dirs = unitDirs().join(" ");
  const always = alwaysRun().join(" ");
  console.log(`mode=${decision.mode} (${decision.reason})`);
  console.log(`dirs=${dirs}`);
  console.log(`always=${always}`);
  if (!process.argv.includes("--explain") && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${decision.mode}\ndirs=${dirs}\nalways=${always}\n`);
  }
}
