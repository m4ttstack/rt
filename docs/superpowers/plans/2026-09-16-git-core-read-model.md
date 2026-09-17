# git-core Read Model Implementation Plan (RT-188, chunk 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, typed git facade (`@mattstack/git-core`) over off-the-shelf clients, with a conformance suite, as the foundation of the headless GitHub Desktop replacement.

**Architecture:** Glance-model facade: `createGitClient(dir)` returns a `GitClient` whose methods map onto simple-git (status, log, stash, diff text) and gitdiff-parser (diff structure), plus ~3 small glue parsers (for-each-ref, fetch state) where no healthy library exists. No mutations, no daemon wiring, no CLI tree changes in this chunk. All parsing bugs land as golden tests first.

**Tech Stack:** Bun + TypeScript (source-only workspace package, no build step), simple-git, gitdiff-parser, bun:test.

**Spec:** Linear RT-188 (https://linear.app/mattstack/issue/RT-188) inside project "Headless git client + mission control" (https://linear.app/mattstack/project/headless-git-client-mission-control-4921d5451e67). The project description carries the audit and sourcing rulings.

## Global Constraints

- Write as little of our own git-client code as possible: simple-git and gitdiff-parser do the work; hand-written parsing is allowed only for `for-each-ref` output, stash-message branch extraction, and FETCH_HEAD state, each with tests.
- NOTHING is copied from `~/Documents/GitHub/workforge/packages/git` (reference-only; known-buggy).
- Read-only chunk: no `git add/commit/checkout/stash push` anywhere in `src/` (test sandboxes may mutate their own temp repos freely).
- The package is `"private": true`, source-only (`exports` point at `./src/index.ts`), never published, no `dist/`.
- Test sandboxes live under `fs.mkdtemp(join(os.tmpdir(), ...))`, NEVER under `~/Documents/GitHub` or the repo tree.
- No UI frameworks, no `.tsx`, no ink/react (repo rule: the TS CLI is UI-free).
- Do not touch `cli.ts`, `lib/command-tree-def.ts`, or `lib/module-registry.ts` in this chunk (no new commands; keeps startup budget untouched).
- Every sandbox git call pins identity: `-c user.email=test@example.com -c user.name=Test` (repo machines have varied global config).
- Commit after every task with a short imperative message ending in the Co-Authored-By line from the session attribution.
- Verify with `bun run test` (covers `packages/`) from the repo root; `bun run test:e2e` is unaffected (no CLI surface changed) but run once at the end of Task 10 anyway.
- No em or en dashes in any file this plan produces.

## File Structure

```
packages/git-core/
  package.json                 private workspace package, deps: simple-git, gitdiff-parser
  tsconfig.json                noEmit type-check config
  README.md                    what it is, what it deliberately excludes (Task 10)
  src/
    index.ts                   barrel: createGitClient + all types
    types.ts                   the facade's data model (the contract chunk 2-4 build on)
    client.ts                  createGitClient(dir): wires the per-area modules
    exec.ts                    tiny raw-git spawn helper (exit-1-tolerant, for --no-index)
    snapshot.ts                RepoSnapshot via simple-git status
    diff.ts                    FileDiff via git diff text + gitdiff-parser
    refs.ts                    branches() + tags() via for-each-ref glue parser
    log.ts                     LogEntry[] via simple-git custom format
    stash.ts                   StashEntry[] via simple-git stashList
    fetch-state.ts             lastFetchedAt via FETCH_HEAD mtime in git-common-dir
    __tests__/
      snapshot.test.ts
      diff.test.ts
      refs.test.ts
      log.test.ts
      stash.test.ts
      fetch-state.test.ts
      conformance.test.ts      cross-cutting sweep over nasty repo states
  test-support/
    sandbox.ts                 mkdtemp repo factory (init, write, commit, bare remote)
    sandbox.test.ts            the factory is itself tested
```

Layering rule locked here: git-core never imports from repo `lib/`. Worktree listing stays in `lib/worktree/git-async.ts` (`listWorktreesAsync`); chunk 3 composes the two.

---

### Task 1: Package scaffold + simple-git-under-Bun smoke test

**Files:**
- Create: `packages/git-core/package.json`
- Create: `packages/git-core/tsconfig.json`
- Create: `packages/git-core/src/index.ts`
- Test: `packages/git-core/src/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the workspace package `@mattstack/git-core`; later tasks import from `./src/<module>.ts` relatively and re-export through `src/index.ts`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "@mattstack/git-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Read-model git facade over simple-git and gitdiff-parser (RT-188)",
  "license": "MIT",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "check-types": "tsc --noEmit -p tsconfig.json"
  },
  "engines": {
    "bun": ">=1.0.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "module": "ESNext",
    "target": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "types": ["bun-types"]
  },
  "include": ["src", "test-support"]
}
```

- [ ] **Step 3: Write the empty barrel**

`packages/git-core/src/index.ts`:

```ts
export {};
```

- [ ] **Step 4: Install deps**

Run from `packages/git-core/`: `bun add simple-git gitdiff-parser`
Then from repo root: `bun install` (links the workspace).
Note: `bun install` at root triggers `postinstall` (rt-client build); that is expected and fine.

- [ ] **Step 5: Write the failing smoke test**

`packages/git-core/src/__tests__/smoke.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";

describe("simple-git under Bun", () => {
  it("spawns git and reads a version", async () => {
    const v = await simpleGit().version();
    expect(v.major).toBeGreaterThanOrEqual(2);
  });

  it("init + status works in a temp dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-core-smoke-"));
    const git = simpleGit({ baseDir: dir });
    await git.init(["-b", "main"]);
    const status = await git.status();
    expect(status.isClean()).toBe(true);
  });
});
```

- [ ] **Step 6: Run it**

Run: `bun test packages/git-core` (from repo root)
Expected: PASS (this validates simple-git's child_process usage under Bun before anything is built on it; if this fails, STOP and report, the sourcing decision needs revisiting).

- [ ] **Step 7: Commit**

```bash
git add packages/git-core bun.lock
git commit -m "git-core: scaffold package with simple-git + gitdiff-parser"
```

---

### Task 2: Sandbox repo factory

**Files:**
- Create: `packages/git-core/test-support/sandbox.ts`
- Test: `packages/git-core/test-support/sandbox.test.ts`

**Interfaces:**
- Consumes: nothing from src.
- Produces (used by every later test file):
  - `makeSandbox(): Promise<Sandbox>` where `Sandbox = { dir: string; git(args: string[]): Promise<string>; write(rel: string, content: string): Promise<void>; commitAll(message: string): Promise<void>; addBareRemote(name?: string): Promise<string>; cleanup(): Promise<void> }`
  - `git()` runs with pinned identity and throws on non-zero exit.

- [ ] **Step 1: Write the failing test**

`packages/git-core/test-support/sandbox.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { makeSandbox } from "./sandbox.ts";

describe("sandbox factory", () => {
  it("creates an initialized repo on main under tmpdir", async () => {
    const sb = await makeSandbox();
    try {
      expect(sb.dir.startsWith(tmpdir())).toBe(true);
      const branch = await sb.git(["branch", "--show-current"]);
      expect(branch.trim()).toBe("main");
    } finally {
      await sb.cleanup();
    }
  });

  it("write + commitAll produces a commit", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "hello\n");
      await sb.commitAll("first");
      const subject = await sb.git(["log", "-1", "--format=%s"]);
      expect(subject.trim()).toBe("first");
    } finally {
      await sb.cleanup();
    }
  });

  it("addBareRemote wires origin and push works", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "hello\n");
      await sb.commitAll("first");
      await sb.addBareRemote();
      await sb.git(["push", "-u", "origin", "main"]);
      const upstream = await sb.git(["rev-parse", "--abbrev-ref", "main@{upstream}"]);
      expect(upstream.trim()).toBe("origin/main");
    } finally {
      await sb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/git-core/test-support`
Expected: FAIL, cannot resolve `./sandbox.ts`.

- [ ] **Step 3: Implement the factory**

`packages/git-core/test-support/sandbox.ts`:

```ts
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface Sandbox {
  dir: string;
  git(args: string[]): Promise<string>;
  write(rel: string, content: string): Promise<void>;
  commitAll(message: string): Promise<void>;
  addBareRemote(name?: string): Promise<string>;
  cleanup(): Promise<void>;
}

const IDENTITY = [
  "-c", "user.email=test@example.com",
  "-c", "user.name=Test",
  "-c", "commit.gpgsign=false",
];

async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...IDENTITY, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${code}: ${err || out}`);
  }
  return out;
}

export async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "git-core-sb-"));
  const dir = join(root, "repo");
  await mkdir(dir, { recursive: true });
  await runGit(dir, ["init", "-b", "main"]);
  return {
    dir,
    git: (args) => runGit(dir, args),
    write: async (rel, content) => {
      const abs = join(dir, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
    },
    commitAll: async (message) => {
      await runGit(dir, ["add", "-A"]);
      await runGit(dir, ["commit", "-m", message]);
    },
    addBareRemote: async (name = "origin") => {
      const remoteDir = join(root, `${name}.git`);
      await runGit(root, ["init", "--bare", remoteDir]);
      await runGit(dir, ["remote", "add", name, remoteDir]);
      return remoteDir;
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test packages/git-core/test-support`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/git-core/test-support
git commit -m "git-core: sandbox repo factory for conformance tests"
```

---

### Task 3: The data model (types.ts) and facade shell

**Files:**
- Create: `packages/git-core/src/types.ts`
- Create: `packages/git-core/src/client.ts`
- Modify: `packages/git-core/src/index.ts`
- Test: `packages/git-core/src/__tests__/client-shape.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (the contract every later task and chunk implements against, verbatim):

```ts
export type FileStatusKind =
  | "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface ChangedFile {
  path: string;
  kind: FileStatusKind;
  staged: boolean;      // some or all of the change is in the index
  unstaged: boolean;    // some or all of the change is in the working tree
  originalPath?: string; // renames only
}

export interface RepoSnapshot {
  branch: string | null;   // null when detached
  detached: boolean;
  upstream: string | null; // e.g. "origin/main", null when none
  ahead: number | null;    // null when no upstream
  behind: number | null;
  files: ChangedFile[];
  clean: boolean;
}

export type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  content: string;          // without the leading +/-/space
  oldLineNo: number | null; // null for adds
  newLineNo: number | null; // null for dels
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string; // the raw @@ line
  lines: DiffLine[];
}

export type FileDiffKind = "text" | "binary" | "submodule";

export interface FileDiff {
  path: string;
  kind: FileDiffKind;
  hunks: DiffHunk[]; // empty for binary/submodule
}

export interface BranchInfo {
  name: string;
  current: boolean;
  sha: string;
  upstream: string | null;
  upstreamGone: boolean;
  ahead: number | null;
  behind: number | null;
  committedAt: string; // ISO 8601
}

export interface TagInfo {
  name: string;
  sha: string;
  annotated: boolean;
}

export interface LogEntry {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string; // ISO 8601
  subject: string;
  body: string;
}

export interface StashEntry {
  index: number;       // 0 = stash@{0}
  branch: string | null;
  message: string;
}

export interface FetchState {
  lastFetchedAt: Date | null; // null = never fetched
}

export interface GitClient {
  readonly dir: string;
  snapshot(): Promise<RepoSnapshot>;
  diffFile(path: string, opts?: { staged?: boolean }): Promise<FileDiff>;
  branches(): Promise<BranchInfo[]>;
  tags(): Promise<TagInfo[]>;
  log(opts?: { maxCount?: number; file?: string }): Promise<LogEntry[]>;
  stashes(): Promise<StashEntry[]>;
  fetchState(): Promise<FetchState>;
}
```

- [ ] **Step 1: Write the failing shape test**

`packages/git-core/src/__tests__/client-shape.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("createGitClient", () => {
  it("returns a client bound to the directory", async () => {
    const sb = await makeSandbox();
    try {
      const client = createGitClient(sb.dir);
      expect(client.dir).toBe(sb.dir);
      expect(typeof client.snapshot).toBe("function");
      expect(typeof client.diffFile).toBe("function");
      expect(typeof client.branches).toBe("function");
      expect(typeof client.tags).toBe("function");
      expect(typeof client.log).toBe("function");
      expect(typeof client.stashes).toBe("function");
      expect(typeof client.fetchState).toBe("function");
    } finally {
      await sb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/git-core/src/__tests__/client-shape.test.ts`
Expected: FAIL, `createGitClient` is not exported.

- [ ] **Step 3: Implement types.ts (the block above, verbatim) and the shell**

`packages/git-core/src/client.ts`:

```ts
import { simpleGit, type SimpleGit } from "simple-git";
import type { GitClient } from "./types.ts";

export interface ClientContext {
  dir: string;
  git: SimpleGit;
}

type Method<K extends keyof GitClient> = GitClient[K];

function unimplemented(name: string): never {
  throw new Error(`git-core: ${name} not implemented yet`);
}

export function createGitClient(dir: string): GitClient {
  const ctx: ClientContext = { dir, git: simpleGit({ baseDir: dir }) };
  return {
    dir,
    snapshot: () => unimplemented("snapshot"),
    diffFile: () => unimplemented("diffFile"),
    branches: () => unimplemented("branches"),
    tags: () => unimplemented("tags"),
    log: () => unimplemented("log"),
    stashes: () => unimplemented("stashes"),
    fetchState: () => unimplemented("fetchState"),
  };
}
```

(Each later task replaces one `unimplemented` line with a call into its module, passing `ctx`.)

`packages/git-core/src/index.ts`:

```ts
export * from "./types.ts";
export { createGitClient } from "./client.ts";
```

- [ ] **Step 4: Run tests + types**

Run: `bun test packages/git-core` then `bun run --cwd packages/git-core check-types`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/git-core/src
git commit -m "git-core: facade contract (types + createGitClient shell)"
```

---

### Task 4: snapshot()

**Files:**
- Create: `packages/git-core/src/snapshot.ts`
- Modify: `packages/git-core/src/client.ts` (wire `snapshot`)
- Test: `packages/git-core/src/__tests__/snapshot.test.ts`

**Interfaces:**
- Consumes: `ClientContext` from Task 3; `Sandbox` from Task 2.
- Produces: `getSnapshot(ctx: ClientContext): Promise<RepoSnapshot>`.

- [ ] **Step 1: Write the failing tests**

`packages/git-core/src/__tests__/snapshot.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function seeded() {
  const sb = await makeSandbox();
  await sb.write("a.txt", "one\n");
  await sb.commitAll("first");
  return sb;
}

describe("snapshot", () => {
  it("clean repo", async () => {
    const sb = await seeded();
    try {
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.branch).toBe("main");
      expect(s.detached).toBe(false);
      expect(s.upstream).toBeNull();
      expect(s.ahead).toBeNull();
      expect(s.behind).toBeNull();
      expect(s.clean).toBe(true);
      expect(s.files).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("untracked file", async () => {
    const sb = await seeded();
    try {
      await sb.write("new.txt", "x\n");
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.files).toEqual([
        { path: "new.txt", kind: "untracked", staged: false, unstaged: true },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("same file staged AND unstaged (MM)", async () => {
    const sb = await seeded();
    try {
      await sb.write("a.txt", "two\n");
      await sb.git(["add", "a.txt"]);
      await sb.write("a.txt", "three\n");
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.files).toEqual([
        { path: "a.txt", kind: "modified", staged: true, unstaged: true },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("staged rename carries originalPath", async () => {
    const sb = await seeded();
    try {
      await sb.git(["mv", "a.txt", "b.txt"]);
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.files).toEqual([
        { path: "b.txt", kind: "renamed", staged: true, unstaged: false, originalPath: "a.txt" },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("merge conflict is conflicted", async () => {
    const sb = await seeded();
    try {
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("a.txt", "feature\n");
      await sb.commitAll("feature change");
      await sb.git(["checkout", "main"]);
      await sb.write("a.txt", "main\n");
      await sb.commitAll("main change");
      await sb.git(["merge", "feature"]).catch(() => {});
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.files).toEqual([
        { path: "a.txt", kind: "conflicted", staged: false, unstaged: true },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("ahead/behind against a bare remote", async () => {
    const sb = await seeded();
    try {
      await sb.addBareRemote();
      await sb.git(["push", "-u", "origin", "main"]);
      await sb.write("a.txt", "local\n");
      await sb.commitAll("local-only");
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.upstream).toBe("origin/main");
      expect(s.ahead).toBe(1);
      expect(s.behind).toBe(0);
    } finally {
      await sb.cleanup();
    }
  });

  it("detached HEAD", async () => {
    const sb = await seeded();
    try {
      const sha = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.git(["checkout", "--detach", sha]);
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.detached).toBe(true);
      expect(s.branch).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  it("empty repo (no commits yet)", async () => {
    const { makeSandbox } = await import("../../test-support/sandbox.ts");
    const sb = await makeSandbox();
    try {
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.branch).toBe("main");
      expect(s.clean).toBe(true);
    } finally {
      await sb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/git-core/src/__tests__/snapshot.test.ts`
Expected: FAIL with "snapshot not implemented yet".

- [ ] **Step 3: Implement**

`packages/git-core/src/snapshot.ts`:

```ts
import type { StatusResult } from "simple-git";
import type { ClientContext } from "./client.ts";
import type { ChangedFile, FileStatusKind, RepoSnapshot } from "./types.ts";

// simple-git exposes per-file index/working_dir XY codes plus aggregate
// lists; the mapping below trusts the per-file codes and uses the
// aggregate `conflicted` list only to identify conflict paths.
function kindOf(index: string, workingDir: string, conflicted: boolean): FileStatusKind {
  if (conflicted) return "conflicted";
  if (index === "?" || workingDir === "?") return "untracked";
  if (index === "R") return "renamed";
  if (index === "A") return "added";
  if (index === "D" || workingDir === "D") return "deleted";
  return "modified";
}

export function mapStatus(status: StatusResult): ChangedFile[] {
  const conflictedSet = new Set(status.conflicted);
  const renamedByTo = new Map(status.renamed.map((r) => [r.to, r.from]));
  return status.files.map((f) => {
    const conflicted = conflictedSet.has(f.path);
    const index = f.index ?? " ";
    const workingDir = f.working_dir ?? " ";
    const kind = kindOf(index, workingDir, conflicted);
    const file: ChangedFile = {
      path: f.path,
      kind,
      staged: !conflicted && index !== " " && index !== "?",
      unstaged: conflicted || (workingDir !== " " && workingDir !== "?") || kind === "untracked",
    };
    const from = renamedByTo.get(f.path);
    if (from !== undefined) file.originalPath = from;
    return file;
  });
}

export async function getSnapshot(ctx: ClientContext): Promise<RepoSnapshot> {
  const status = await ctx.git.status();
  const files = mapStatus(status);
  return {
    branch: status.detached ? null : status.current,
    detached: status.detached,
    upstream: status.tracking,
    ahead: status.tracking === null ? null : status.ahead,
    behind: status.tracking === null ? null : status.behind,
    files,
    clean: files.length === 0,
  };
}
```

Wire it in `client.ts`: replace the `snapshot` stub with `snapshot: () => getSnapshot(ctx),` and add `import { getSnapshot } from "./snapshot.ts";`.

- [ ] **Step 4: Run tests, adjust mapping to observed reality**

Run: `bun test packages/git-core/src/__tests__/snapshot.test.ts`
Expected: PASS. If a mapping assertion fails, the fix goes in `mapStatus` (the test expectations are the spec; they encode GitHub Desktop-equivalent semantics). Two known wobble points to check against reality rather than assume: simple-git's `status.current` value in an empty repo, and whether a rename row's `path` field is `to` or `from`. Pin whichever git actually reports; if `current` is `null` in the empty repo, change that one assertion to match observed git behavior and note it in the test with a one-line comment.

- [ ] **Step 5: Run the full package suite + types**

Run: `bun test packages/git-core` and `bun run --cwd packages/git-core check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/git-core/src
git commit -m "git-core: snapshot() over simple-git status"
```

---

### Task 5: diffFile()

**Files:**
- Create: `packages/git-core/src/exec.ts`
- Create: `packages/git-core/src/diff.ts`
- Modify: `packages/git-core/src/client.ts` (wire `diffFile`)
- Test: `packages/git-core/src/__tests__/diff.test.ts`

**Interfaces:**
- Consumes: `ClientContext`, `Sandbox`, types from Task 3.
- Produces: `getFileDiff(ctx: ClientContext, path: string, opts?: { staged?: boolean }): Promise<FileDiff>` and `rawGit(dir: string, args: string[], opts?: { okCodes?: number[] }): Promise<string>`.

The parsing itself is gitdiff-parser's job. Our code only: (a) obtains the diff text, (b) maps gitdiff-parser's model to `FileDiff`, (c) classifies binary/submodule. The golden cases below are exactly the bugs found in the hand-rolled workforge parser; they must pass through the library.

- [ ] **Step 1: Write the failing tests**

`packages/git-core/src/__tests__/diff.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function seeded(content: string) {
  const sb = await makeSandbox();
  await sb.write("f.txt", content);
  await sb.commitAll("base");
  return sb;
}

describe("diffFile", () => {
  it("basic modification with correct line numbers", async () => {
    const sb = await seeded("a\nb\nc\n");
    try {
      await sb.write("f.txt", "a\nB\nc\n");
      const d = await createGitClient(sb.dir).diffFile("f.txt");
      expect(d.kind).toBe("text");
      expect(d.hunks.length).toBe(1);
      const lines = d.hunks[0]!.lines;
      expect(lines.map((l) => l.type)).toEqual(["context", "del", "add", "context"]);
      expect(lines[1]).toMatchObject({ content: "b", oldLineNo: 2, newLineNo: null });
      expect(lines[2]).toMatchObject({ content: "B", oldLineNo: null, newLineNo: 2 });
    } finally {
      await sb.cleanup();
    }
  });

  it("deleted line whose content starts with '-- ' (SQL comment)", async () => {
    const sb = await seeded("select 1;\n-- comment\nselect 2;\n");
    try {
      await sb.write("f.txt", "select 1;\nselect 2;\n");
      const d = await createGitClient(sb.dir).diffFile("f.txt");
      const dels = d.hunks[0]!.lines.filter((l) => l.type === "del");
      expect(dels).toEqual([
        { type: "del", content: "-- comment", oldLineNo: 2, newLineNo: null },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("added line starting with '++' (C increment)", async () => {
    const sb = await seeded("int x;\n");
    try {
      await sb.write("f.txt", "int x;\n++x;\n");
      const d = await createGitClient(sb.dir).diffFile("f.txt");
      const adds = d.hunks[0]!.lines.filter((l) => l.type === "add");
      expect(adds).toEqual([
        { type: "add", content: "++x;", oldLineNo: null, newLineNo: 2 },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("trailing blank context line survives", async () => {
    const sb = await seeded("a\n\nb\n");
    try {
      await sb.write("f.txt", "a\n\nB\n");
      const d = await createGitClient(sb.dir).diffFile("f.txt");
      const lines = d.hunks[0]!.lines;
      // context "a", context "", del "b", add "B"
      expect(lines.map((l) => [l.type, l.content])).toEqual([
        ["context", "a"],
        ["context", ""],
        ["del", "b"],
        ["add", "B"],
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("no newline at EOF does not corrupt lines", async () => {
    const sb = await seeded("a\nb");
    try {
      await sb.write("f.txt", "a\nc");
      const d = await createGitClient(sb.dir).diffFile("f.txt");
      const lines = d.hunks[0]!.lines;
      expect(lines.filter((l) => l.type === "del").map((l) => l.content)).toEqual(["b"]);
      expect(lines.filter((l) => l.type === "add").map((l) => l.content)).toEqual(["c"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("staged=true diffs the index", async () => {
    const sb = await seeded("a\n");
    try {
      await sb.write("f.txt", "staged\n");
      await sb.git(["add", "f.txt"]);
      await sb.write("f.txt", "working\n");
      const staged = await createGitClient(sb.dir).diffFile("f.txt", { staged: true });
      const unstaged = await createGitClient(sb.dir).diffFile("f.txt");
      expect(staged.hunks[0]!.lines.some((l) => l.content === "staged")).toBe(true);
      expect(unstaged.hunks[0]!.lines.some((l) => l.content === "working")).toBe(true);
    } finally {
      await sb.cleanup();
    }
  });

  it("untracked file diffs as all-adds", async () => {
    const sb = await seeded("a\n");
    try {
      await sb.write("new.txt", "one\ntwo\n");
      const d = await createGitClient(sb.dir).diffFile("new.txt");
      expect(d.kind).toBe("text");
      expect(d.hunks[0]!.lines.map((l) => [l.type, l.content])).toEqual([
        ["add", "one"],
        ["add", "two"],
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("binary file is classified, no hunks", async () => {
    const sb = await seeded("a\n");
    try {
      await sb.git(["config", "core.autocrlf", "false"]);
      const bytes = new Uint8Array([0, 1, 2, 255, 0, 40, 10]);
      await Bun.write(`${sb.dir}/bin.dat`, bytes);
      await sb.git(["add", "bin.dat"]);
      await sb.git(["commit", "-m", "add binary"]);
      await Bun.write(`${sb.dir}/bin.dat`, new Uint8Array([9, 9, 0, 255]));
      const d = await createGitClient(sb.dir).diffFile("bin.dat");
      expect(d.kind).toBe("binary");
      expect(d.hunks).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/git-core/src/__tests__/diff.test.ts`
Expected: FAIL with "diffFile not implemented yet".

- [ ] **Step 3: Implement exec.ts**

`packages/git-core/src/exec.ts`:

```ts
export interface RawGitOpts {
  okCodes?: number[]; // exit codes besides 0 that still return stdout
}

// git diff --no-index exits 1 when files differ; simple-git treats that
// as failure, so the one raw runner lives here.
export async function rawGit(dir: string, args: string[], opts: RawGitOpts = {}): Promise<string> {
  const ok = new Set([0, ...(opts.okCodes ?? [])]);
  const proc = Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (!ok.has(code)) {
    throw new Error(`git ${args.join(" ")} exited ${code}: ${err || out}`);
  }
  return out;
}
```

- [ ] **Step 4: Implement diff.ts**

`packages/git-core/src/diff.ts`:

```ts
import parser from "gitdiff-parser";
import type { ClientContext } from "./client.ts";
import type { DiffHunk, DiffLine, FileDiff } from "./types.ts";
import { rawGit } from "./exec.ts";

type ParsedFile = ReturnType<typeof parser.parse>[number];

function mapLines(hunk: ParsedFile["hunks"][number]): DiffLine[] {
  return hunk.changes.map((c): DiffLine => {
    if (c.type === "insert") {
      return { type: "add", content: c.content, oldLineNo: null, newLineNo: c.lineNumber ?? null };
    }
    if (c.type === "delete") {
      return { type: "del", content: c.content, oldLineNo: c.lineNumber ?? null, newLineNo: null };
    }
    return {
      type: "context",
      content: c.content,
      oldLineNo: c.oldLineNumber ?? null,
      newLineNo: c.newLineNumber ?? null,
    };
  });
}

function mapHunks(file: ParsedFile): DiffHunk[] {
  return file.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    header: h.content,
    lines: mapLines(h),
  }));
}

export async function getFileDiff(
  ctx: ClientContext,
  path: string,
  opts: { staged?: boolean } = {},
): Promise<FileDiff> {
  const status = await ctx.git.status();
  const untracked = status.not_added.includes(path);

  let text: string;
  if (untracked) {
    text = await rawGit(ctx.dir, ["diff", "--no-index", "--", "/dev/null", path], { okCodes: [1] });
  } else {
    const args = opts.staged ? ["--cached", "--", path] : ["--", path];
    text = await ctx.git.diff(args);
  }

  if (text.trim() === "") return { path, kind: "text", hunks: [] };
  if (/^Binary files .* differ$/m.test(text) || text.includes("GIT binary patch")) {
    return { path, kind: "binary", hunks: [] };
  }
  if (/^[+-]Subproject commit /m.test(text)) {
    return { path, kind: "submodule", hunks: [] };
  }

  const files = parser.parse(text);
  const hunks = files.length > 0 ? mapHunks(files[0]!) : [];
  return { path, kind: "text", hunks };
}
```

Wire it in `client.ts`: `diffFile: (path, opts) => getFileDiff(ctx, path, opts),`.

- [ ] **Step 5: Run tests and settle the library question on evidence**

Run: `bun test packages/git-core/src/__tests__/diff.test.ts`
Expected: PASS. Contingencies, in order:
1. If gitdiff-parser's change fields differ from the names used above (`lineNumber`, `oldLineNumber`, `newLineNumber`, `type` of `insert|delete|normal`), fix `mapLines` to the library's actual typings (it ships TypeScript types; follow them, not this plan).
2. If the `-- `/`++` or trailing-blank-context tests fail inside the library, swap to `parse-diff` (`bun add parse-diff`, remove gitdiff-parser) and rewrite ONLY `mapLines`/`mapHunks` around its `{chunks, changes: {type: "add"|"del"|"normal", ln, ln1, ln2, content}}` model, where `content` keeps the `+`/`-`/space prefix that must be stripped with `.slice(1)`.
3. If BOTH libraries fail a golden case, stop and report the failing case verbatim; do not hand-roll a parser without a human decision.

- [ ] **Step 6: Run the full package suite + types**

Run: `bun test packages/git-core` and `bun run --cwd packages/git-core check-types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/git-core/src
git commit -m "git-core: diffFile() over gitdiff-parser with golden edge cases"
```

---

### Task 6: branches() and tags() (refs.ts)

**Files:**
- Create: `packages/git-core/src/refs.ts`
- Modify: `packages/git-core/src/client.ts` (wire `branches`, `tags`)
- Test: `packages/git-core/src/__tests__/refs.test.ts`

**Interfaces:**
- Consumes: `ClientContext`, `rawGit` from Task 5.
- Produces: `getBranches(ctx): Promise<BranchInfo[]>`, `getTags(ctx): Promise<TagInfo[]>`.

This is one of the three sanctioned glue parsers: `for-each-ref` with `%00` field separators is machine-stable output, and no maintained library models upstream-track.

- [ ] **Step 1: Write the failing tests**

`packages/git-core/src/__tests__/refs.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function seeded() {
  const sb = await makeSandbox();
  await sb.write("a.txt", "one\n");
  await sb.commitAll("first");
  return sb;
}

describe("branches", () => {
  it("lists branches with current flag and sha", async () => {
    const sb = await seeded();
    try {
      await sb.git(["branch", "feature"]);
      const branches = await createGitClient(sb.dir).branches();
      const names = branches.map((b) => b.name).sort();
      expect(names).toEqual(["feature", "main"]);
      const main = branches.find((b) => b.name === "main")!;
      expect(main.current).toBe(true);
      expect(main.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(main.upstream).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  it("ahead/behind and upstream after push + local commit", async () => {
    const sb = await seeded();
    try {
      await sb.addBareRemote();
      await sb.git(["push", "-u", "origin", "main"]);
      await sb.write("a.txt", "two\n");
      await sb.commitAll("second");
      const main = (await createGitClient(sb.dir).branches()).find((b) => b.name === "main")!;
      expect(main.upstream).toBe("origin/main");
      expect(main.ahead).toBe(1);
      expect(main.behind).toBe(0);
      expect(main.upstreamGone).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });

  it("upstreamGone when the remote branch is deleted", async () => {
    const sb = await seeded();
    try {
      await sb.addBareRemote();
      await sb.git(["push", "-u", "origin", "main"]);
      await sb.git(["push", "origin", "--delete", "main"]);
      await sb.git(["fetch", "--prune", "origin"]);
      const main = (await createGitClient(sb.dir).branches()).find((b) => b.name === "main")!;
      expect(main.upstreamGone).toBe(true);
      expect(main.ahead).toBeNull();
      expect(main.behind).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });
});

describe("tags", () => {
  it("annotated vs lightweight", async () => {
    const sb = await seeded();
    try {
      await sb.git(["tag", "light"]);
      await sb.git(["tag", "-a", "heavy", "-m", "annotated"]);
      const tags = await createGitClient(sb.dir).tags();
      const byName = new Map(tags.map((t) => [t.name, t]));
      expect(byName.get("light")!.annotated).toBe(false);
      expect(byName.get("heavy")!.annotated).toBe(true);
      expect(byName.get("light")!.sha).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await sb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/git-core/src/__tests__/refs.test.ts`
Expected: FAIL with "branches not implemented yet".

- [ ] **Step 3: Implement refs.ts**

`packages/git-core/src/refs.ts`:

```ts
import type { ClientContext } from "./client.ts";
import type { BranchInfo, TagInfo } from "./types.ts";
import { rawGit } from "./exec.ts";

const FS = " ";

const BRANCH_FORMAT = [
  "%(HEAD)",
  "%(refname:short)",
  "%(objectname)",
  "%(upstream:short)",
  "%(upstream:track)",
  "%(committerdate:iso8601-strict)",
].join(FS);

function parseTrack(track: string): { ahead: number | null; behind: number | null; gone: boolean } {
  if (track === "[gone]") return { ahead: null, behind: null, gone: true };
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    gone: false,
  };
}

export async function getBranches(ctx: ClientContext): Promise<BranchInfo[]> {
  const out = await rawGit(ctx.dir, [
    "for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads",
  ]);
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [head, name, sha, upstream, track, committedAt] = line.split(FS);
      const hasUpstream = (upstream ?? "") !== "";
      const t = hasUpstream ? parseTrack(track ?? "") : { ahead: null, behind: null, gone: false };
      return {
        name: name ?? "",
        current: head === "*",
        sha: sha ?? "",
        upstream: hasUpstream ? upstream! : null,
        upstreamGone: t.gone,
        ahead: t.gone ? null : t.ahead,
        behind: t.gone ? null : t.behind,
        committedAt: committedAt ?? "",
      };
    });
}

const TAG_FORMAT = ["%(refname:short)", "%(objectname)", "%(objecttype)"].join(FS);

export async function getTags(ctx: ClientContext): Promise<TagInfo[]> {
  const out = await rawGit(ctx.dir, ["for-each-ref", `--format=${TAG_FORMAT}`, "refs/tags"]);
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, sha, objectType] = line.split(FS);
      return { name: name ?? "", sha: sha ?? "", annotated: objectType === "tag" };
    });
}
```

Wire both in `client.ts`.

- [ ] **Step 4: Run tests**

Run: `bun test packages/git-core/src/__tests__/refs.test.ts`
Expected: PASS. Known wobble: a branch with an upstream but no divergence yields an empty `%(upstream:track)` string; `parseTrack("")` returns 0/0 which is correct.

- [ ] **Step 5: Commit**

```bash
git add packages/git-core/src
git commit -m "git-core: branches() and tags() via for-each-ref glue"
```

---

### Task 7: log()

**Files:**
- Create: `packages/git-core/src/log.ts`
- Modify: `packages/git-core/src/client.ts` (wire `log`)
- Test: `packages/git-core/src/__tests__/log.test.ts`

**Interfaces:**
- Consumes: `ClientContext`.
- Produces: `getLog(ctx, opts?: { maxCount?: number; file?: string }): Promise<LogEntry[]>`.

- [ ] **Step 1: Write the failing tests**

`packages/git-core/src/__tests__/log.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("log", () => {
  it("returns entries newest-first with parents and body", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      await sb.git(["add", "-A"]);
      await sb.git(["commit", "-m", "second", "-m", "body line one\nbody line two"]);
      const log = await createGitClient(sb.dir).log();
      expect(log.length).toBe(2);
      expect(log[0]!.subject).toBe("second");
      expect(log[0]!.body).toContain("body line two");
      expect(log[0]!.parents.length).toBe(1);
      expect(log[1]!.subject).toBe("first");
      expect(log[1]!.parents).toEqual([]);
      expect(log[0]!.authorEmail).toBe("test@example.com");
      expect(log[0]!.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await sb.cleanup();
    }
  });

  it("maxCount and file filter", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("touch a");
      await sb.write("b.txt", "1\n");
      await sb.commitAll("touch b");
      await sb.write("a.txt", "2\n");
      await sb.commitAll("touch a again");
      const client = createGitClient(sb.dir);
      expect((await client.log({ maxCount: 1 })).length).toBe(1);
      const onlyA = await client.log({ file: "a.txt" });
      expect(onlyA.map((e) => e.subject)).toEqual(["touch a again", "touch a"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("empty repo returns []", async () => {
    const sb = await makeSandbox();
    try {
      expect(await createGitClient(sb.dir).log()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/git-core/src/__tests__/log.test.ts`
Expected: FAIL with "log not implemented yet".

- [ ] **Step 3: Implement**

`packages/git-core/src/log.ts`:

```ts
import type { ClientContext } from "./client.ts";
import type { LogEntry } from "./types.ts";

const FORMAT = {
  sha: "%H",
  parents: "%P",
  authorName: "%an",
  authorEmail: "%ae",
  authorDate: "%aI",
  subject: "%s",
  body: "%b",
};

export async function getLog(
  ctx: ClientContext,
  opts: { maxCount?: number; file?: string } = {},
): Promise<LogEntry[]> {
  try {
    const result = await ctx.git.log({
      format: FORMAT,
      ...(opts.maxCount !== undefined ? { maxCount: opts.maxCount } : {}),
      ...(opts.file !== undefined ? { file: opts.file } : {}),
    });
    return result.all.map((e) => ({
      sha: e.sha,
      parents: e.parents === "" ? [] : e.parents.split(" "),
      authorName: e.authorName,
      authorEmail: e.authorEmail,
      authorDate: e.authorDate,
      subject: e.subject,
      body: e.body.trimEnd(),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A repo with no commits has no HEAD to log from.
    if (message.includes("does not have any commits yet") || message.includes("unknown revision")) {
      return [];
    }
    throw err;
  }
}
```

Wire it in `client.ts`.

- [ ] **Step 4: Run tests**

Run: `bun test packages/git-core/src/__tests__/log.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/git-core/src
git commit -m "git-core: log() with parents via simple-git custom format"
```

---

### Task 8: stashes()

**Files:**
- Create: `packages/git-core/src/stash.ts`
- Modify: `packages/git-core/src/client.ts` (wire `stashes`)
- Test: `packages/git-core/src/__tests__/stash.test.ts`

**Interfaces:**
- Consumes: `ClientContext`.
- Produces: `getStashes(ctx): Promise<StashEntry[]>`.

- [ ] **Step 1: Write the failing tests**

`packages/git-core/src/__tests__/stash.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("stashes", () => {
  it("empty when no stash", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      expect(await createGitClient(sb.dir).stashes()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("parses message and branch, index 0 is newest", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      await sb.git(["stash", "push", "-m", "older work"]);
      await sb.write("a.txt", "3\n");
      await sb.git(["stash", "push", "-m", "newer work"]);
      const stashes = await createGitClient(sb.dir).stashes();
      expect(stashes.length).toBe(2);
      expect(stashes[0]).toEqual({ index: 0, branch: "main", message: "newer work" });
      expect(stashes[1]).toEqual({ index: 1, branch: "main", message: "older work" });
    } finally {
      await sb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/git-core/src/__tests__/stash.test.ts`
Expected: FAIL with "stashes not implemented yet".

- [ ] **Step 3: Implement**

`packages/git-core/src/stash.ts`:

```ts
import type { ClientContext } from "./client.ts";
import type { StashEntry } from "./types.ts";

// Reflog subjects look like "On main: newer work" or "WIP on main: <sha> <subject>".
const ON_BRANCH = /^(?:WIP on|On) ([^:]+): (.*)$/;

export async function getStashes(ctx: ClientContext): Promise<StashEntry[]> {
  const list = await ctx.git.stashList();
  return list.all.map((entry, index) => {
    const m = ON_BRANCH.exec(entry.message);
    return {
      index,
      branch: m ? m[1]! : null,
      message: m ? m[2]! : entry.message,
    };
  });
}
```

Wire it in `client.ts`.

- [ ] **Step 4: Run and reconcile against simple-git reality**

Run: `bun test packages/git-core/src/__tests__/stash.test.ts`
Expected: PASS. Known wobble: simple-git's `stashList()` message field may already include the `stash@{n}: ` prefix depending on version; if the test shows `message` values like `stash@{0}: On main: newer work`, strip the leading `stash@{n}: ` with `/^stash@\{\d+\}: /` before applying `ON_BRANCH`, and keep the test expectations unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/git-core/src
git commit -m "git-core: stashes() over simple-git stashList"
```

---

### Task 9: fetchState()

**Files:**
- Create: `packages/git-core/src/fetch-state.ts`
- Modify: `packages/git-core/src/client.ts` (wire `fetchState`)
- Test: `packages/git-core/src/__tests__/fetch-state.test.ts`

**Interfaces:**
- Consumes: `ClientContext`, `rawGit`.
- Produces: `getFetchState(ctx): Promise<FetchState>`.

- [ ] **Step 1: Write the failing tests**

`packages/git-core/src/__tests__/fetch-state.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("fetchState", () => {
  it("null before any fetch", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      const state = await createGitClient(sb.dir).fetchState();
      expect(state.lastFetchedAt).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  it("a recent Date after fetching from a bare remote", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.addBareRemote();
      await sb.git(["push", "-u", "origin", "main"]);
      await sb.git(["fetch", "origin"]);
      const state = await createGitClient(sb.dir).fetchState();
      expect(state.lastFetchedAt).not.toBeNull();
      expect(Date.now() - state.lastFetchedAt!.getTime()).toBeLessThan(60_000);
    } finally {
      await sb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/git-core/src/__tests__/fetch-state.test.ts`
Expected: FAIL with "fetchState not implemented yet".

- [ ] **Step 3: Implement**

`packages/git-core/src/fetch-state.ts`:

```ts
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ClientContext } from "./client.ts";
import type { FetchState } from "./types.ts";
import { rawGit } from "./exec.ts";

// FETCH_HEAD lives in the common dir so linked worktrees share it.
export async function getFetchState(ctx: ClientContext): Promise<FetchState> {
  const commonDirRaw = (await rawGit(ctx.dir, ["rev-parse", "--git-common-dir"])).trim();
  const commonDir = isAbsolute(commonDirRaw) ? commonDirRaw : join(ctx.dir, commonDirRaw);
  try {
    const s = await stat(join(commonDir, "FETCH_HEAD"));
    return { lastFetchedAt: s.mtime };
  } catch {
    return { lastFetchedAt: null };
  }
}
```

Wire it in `client.ts`.

- [ ] **Step 4: Run tests**

Run: `bun test packages/git-core/src/__tests__/fetch-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/git-core/src
git commit -m "git-core: fetchState() from FETCH_HEAD mtime in the common dir"
```

---

### Task 10: Conformance sweep, README, and full verification

**Files:**
- Create: `packages/git-core/src/__tests__/conformance.test.ts`
- Create: `packages/git-core/README.md`

**Interfaces:**
- Consumes: everything.
- Produces: the cross-cutting guarantee later chunks rely on: every read method is safe on every repo state (it returns data or a typed empty, never throws on a weird-but-valid repo).

- [ ] **Step 1: Write the conformance sweep**

`packages/git-core/src/__tests__/conformance.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { makeSandbox, type Sandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

// Every read method must succeed (not throw) on every repo state below.
type Scenario = { name: string; setup: (sb: Sandbox) => Promise<void> };

const SCENARIOS: Scenario[] = [
  { name: "empty repo, no commits", setup: async () => {} },
  {
    name: "one commit, clean",
    setup: async (sb) => {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
    },
  },
  {
    name: "detached HEAD",
    setup: async (sb) => {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      const sha = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.git(["checkout", "--detach", sha]);
    },
  },
  {
    name: "mid-merge conflict",
    setup: async (sb) => {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("a.txt", "f\n");
      await sb.commitAll("feature");
      await sb.git(["checkout", "main"]);
      await sb.write("a.txt", "m\n");
      await sb.commitAll("main");
      await sb.git(["merge", "feature"]).catch(() => {});
    },
  },
  {
    name: "mid-rebase conflict",
    setup: async (sb) => {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("a.txt", "f\n");
      await sb.commitAll("feature");
      await sb.git(["checkout", "main"]);
      await sb.write("a.txt", "m\n");
      await sb.commitAll("main");
      await sb.git(["checkout", "feature"]);
      await sb.git(["rebase", "main"]).catch(() => {});
    },
  },
  {
    name: "unborn branch with staged file",
    setup: async (sb) => {
      await sb.write("a.txt", "1\n");
      await sb.git(["add", "a.txt"]);
    },
  },
];

describe("conformance: every read survives every repo state", () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const sb = await makeSandbox();
      try {
        await scenario.setup(sb);
        const client = createGitClient(sb.dir);
        const snapshot = await client.snapshot();
        expect(Array.isArray(snapshot.files)).toBe(true);
        expect(Array.isArray(await client.branches())).toBe(true);
        expect(Array.isArray(await client.tags())).toBe(true);
        expect(Array.isArray(await client.log())).toBe(true);
        expect(Array.isArray(await client.stashes())).toBe(true);
        expect(await client.fetchState()).toHaveProperty("lastFetchedAt");
        for (const file of snapshot.files) {
          const diff = await client.diffFile(file.path, { staged: false });
          expect(["text", "binary", "submodule"]).toContain(diff.kind);
        }
      } finally {
        await sb.cleanup();
      }
    });
  }
});
```

- [ ] **Step 2: Run it; fix only inside the modules**

Run: `bun test packages/git-core/src/__tests__/conformance.test.ts`
Expected: PASS. If a scenario throws, the fix belongs in the module that threw (e.g. `snapshot` on the unborn branch), following the same pattern as `getLog`'s empty-repo catch: catch the specific git message, return the typed empty. Never loosen a conformance assertion.

- [ ] **Step 3: Export Sandbox type if not already**

Ensure `test-support/sandbox.ts` exports the `Sandbox` interface (the conformance test imports it).

- [ ] **Step 4: Write README.md**

`packages/git-core/README.md`:

```markdown
# @mattstack/git-core

Read-model git facade for rt (RT-188): typed snapshots, diffs, refs, log,
stashes, and fetch state over simple-git and gitdiff-parser. Private,
source-only, consumed via the workspace.

What it deliberately is NOT (yet):
- No mutations (staging, commit, checkout, stash push): RT-189.
- No worktree listing: rt's `lib/worktree/git-async.ts` owns that; the
  daemon layer composes the two (RT-190).
- No forge calls: `@mattstack/glance` and the daemon MR cache own those.

Design rule: off-the-shelf clients do the parsing. Hand-written parsing
is limited to for-each-ref, stash reflog subjects, and FETCH_HEAD state,
each pinned by tests in `src/__tests__/`.
```

- [ ] **Step 5: Full verification**

Run, from the repo root:
1. `bun run test` (expected: PASS; covers packages/)
2. `bun run --cwd packages/git-core check-types` (expected: clean)
3. `bun run test:e2e` (expected: PASS; nothing CLI-facing changed, this is the belt-and-suspenders check the repo's footgun notes demand)
4. `git status` shows only intended files.

- [ ] **Step 6: Commit**

```bash
git add packages/git-core
git commit -m "git-core: conformance sweep + README"
```

---

## Self-Review (performed while writing)

1. **Spec coverage vs RT-188:** facade + types (Task 3), simple-git adapter for status/branches/log/stash/tags/fetch (Tasks 4, 6, 7, 8, 9), diff adapter with the library decision made on golden evidence (Task 5), sandbox-in-tmpdir requirement (Task 2, enforced by an assertion), golden fixtures for the workforge bug classes (Task 5 tests 2, 3, 4, 5), conformance suite over nasty states (Task 10). Worktree-list reuse is intentionally re-scoped out of the package (layering note in File Structure + README); RT-190 composes it. RT-188's ticket text says "reuse rt's existing porcelain parsing": satisfied by NOT duplicating it here.
2. **Placeholder scan:** no TBDs; the two "known wobble" notes name the exact field, the exact observed alternative, and the exact fix location; the Task 5 library contingency names the replacement package and the only two functions allowed to change.
3. **Type consistency:** `ClientContext` produced in Task 3 and consumed in 4-9; `rawGit` produced in Task 5, consumed in 6 and 9 (Task 6 lists it); `Sandbox` produced in Task 2, type-exported check in Task 10 Step 3. `FileDiffKind` values match the conformance assertion list.
```
