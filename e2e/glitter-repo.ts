/**
 * A sandbox git repo for the glitter pty gate: every working-tree shape the
 * board renders differently (staged, unstaged, multi-hunk, untracked,
 * deleted), built by argv-only git so no developer config leaks in.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export interface GlitterRepo {
  path: string;
  git(...args: string[]): string;
  /** Subject lines of the last `n` commits, newest first. */
  log(n?: number): string[];
  /** Paths git reports as staged (index differs from HEAD). */
  staged(): string[];
  cleanup(): void;
}

// A commit needs an identity and the sandbox HOME has none, so every
// invocation carries one. -c keeps it out of any config file.
const IDENT = [
  "-c", "user.name=rt-test",
  "-c", "user.email=test@rt.test",
  "-c", "commit.gpgsign=false",
  "-c", "init.defaultBranch=main",
];

export function createGlitterRepo(): GlitterRepo {
  const path = mkdtempSync(join(tmpdir(), "rt-glitter-"));

  const git = (...args: string[]): string =>
    execFileSync("git", [...IDENT, ...args], {
      cwd: path,
      encoding: "utf8",
      stdio: "pipe",
      // A developer's own git env would otherwise reach into the sandbox.
      env: { PATH: process.env.PATH ?? "", HOME: path, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    }).trim();

  git("init", "-q");

  mkdirSync(join(path, "src"), { recursive: true });
  writeFileSync(join(path, "config.json"), '{\n  "name": "sandbox",\n  "maxTokens": 2048\n}\n');
  writeFileSync(join(path, "src", "parser.ts"), parserV1());
  writeFileSync(join(path, "src", "legacy.ts"), "export const legacy = true;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "seed the sandbox");

  // Staged: the index differs from HEAD before glitter ever opens.
  writeFileSync(join(path, "config.json"), '{\n  "name": "sandbox",\n  "maxTokens": 4096\n}\n');
  git("add", "config.json");

  // Unstaged, and far enough apart to land in separate hunks.
  writeFileSync(join(path, "src", "parser.ts"), parserV2());

  // Deleted and untracked.
  unlinkSync(join(path, "src", "legacy.ts"));
  writeFileSync(join(path, "NOTES.md"), "# Notes\n\nScratch.\n");

  return {
    path,
    git,
    log: (n = 10) => git("log", `-${n}`, "--format=%s").split("\n").filter(Boolean),
    staged: () => git("diff", "--cached", "--name-only").split("\n").filter(Boolean),
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}

function parserV1(): string {
  return [
    "export interface Token {",
    '  kind: "word" | "symbol";',
    "  value: string;",
    "}",
    "",
    "export function tokenize(input: string): Token[] {",
    "  const tokens: Token[] = [];",
    "  let i = 0;",
    "  while (i < input.length) {",
    "    const ch = input[i]!;",
    '    tokens.push({ kind: "symbol", value: ch });',
    "    i += 1;",
    "  }",
    "  return tokens;",
    "}",
    "",
  ].join("\n");
}

function parserV2(): string {
  return parserV1()
    .replace('  kind: "word" | "symbol";', '  kind: "word" | "symbol" | "string";')
    .replace("  let i = 0;", "  let i = 0;\n  let depth = 0;")
    .replace(
      '    tokens.push({ kind: "symbol", value: ch });',
      '    if (ch === "(") depth += 1;\n    tokens.push({ kind: "symbol", value: ch });',
    );
}
