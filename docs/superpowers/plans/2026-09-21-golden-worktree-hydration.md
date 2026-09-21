# Golden Worktree Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cold create of on-deck worktree members with an APFS `clonefile(2)` of a per-repo golden tree's artifacts, cutting top-up from ~7 min to ~1.5 min per tree.

**Architecture:** A new `kind: "golden"` registry row per pooled repo is built and freshened by today's `createTree`/freshen code and never claimed. Replenish hydrates new members from it: `git worktree add` at the golden's `readyStamp`, one `clonefile` per git-ignored path through a hidden child-process verb, then inherit `readyStamp`/`readyAt` so the existing `changed:` logic skips every ready step. Every fallback lands on today's cold create.

**Tech Stack:** Bun/TypeScript daemon, `bun:ffi` against `libSystem.B.dylib` for `clonefile`, `bun:test`, real temp git repos in tests (existing pattern).

**Spec:** `docs/superpowers/specs/2026-09-21-golden-worktree-hydration-design.md`

## Global Constraints

- The TS CLI stays UI-free: no `.tsx`, no UI frameworks (`lib/__tests__/no-ui-in-cli.test.ts`).
- Any new command module must be a thunk in `lib/module-registry.ts`; `./commands/worktree.ts` is already registered, so the new verb lives there.
- A hidden leaf with required positionals declares `omitBehavior: { exempt: "..." }` (`bun run picker:check`).
- Never sync-exec or block on the daemon thread: the clone runs in a child process via `runCapture`.
- Nothing in a `V*_SCHEMA` block changes; the registry is kv rows, no migration.
- Tests run under the bunfig-preloaded isolated HOME; every test that touches the registry sets `process.env.HOME` to a fresh temp dir and calls `closeStateDb()` (see `lib/daemon/reconciler/__tests__/replenish.test.ts`).
- No em dashes or en dashes anywhere (code, comments, commits, docs).
- Comments state constraints the code cannot show; no narration, no ticket ids, no decision history.
- Commit after every task with a short imperative message ending in the attribution line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Public repo: run `scripts/repo-purity.sh` (if present) before any push; no personal identifiers in code or tests.

---

### Task 1: Verify `bun:ffi` `clonefile` under the hardened runtime

**Files:**
- Create (scratch only, not committed): `<scratchpad>/ffi-check/clone.ts`
- Modify: this plan file, the **Outcome** line at the end of this task

**Interfaces:**
- Produces: a go/no-go for `bun:ffi` in the compiled, signed `rt`. Task 3 depends on "go". On "no-go", Task 3 and Task 4 use the Go helper described in **Appendix A** instead; every other task is unchanged.

- [ ] **Step 1: Write the probe script**

```ts
// <scratchpad>/ffi-check/clone.ts
import { dlopen, FFIType, ptr, read } from "bun:ffi";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const lib = dlopen("/usr/lib/libSystem.B.dylib", {
  clonefile: { args: [FFIType.cstring, FFIType.cstring, FFIType.u32], returns: FFIType.i32 },
  __error: { args: [], returns: FFIType.ptr },
});
const cstr = (s: string) => ptr(Buffer.from(`${s}\0`));

const dir = mkdtempSync(join(tmpdir(), "ffi-check-"));
mkdirSync(join(dir, "src", "nested"), { recursive: true });
writeFileSync(join(dir, "src", "nested", "a.txt"), "hello\n");

const rc = lib.symbols.clonefile(cstr(join(dir, "src")), cstr(join(dir, "dst")), 0);
if (rc !== 0) {
  const errno = read.i32(lib.symbols.__error()!, 0);
  console.error(`clonefile failed errno=${errno}`);
  process.exit(1);
}
const back = readFileSync(join(dir, "dst", "nested", "a.txt"), "utf8");
console.log(back === "hello\n" ? "ffi clonefile ok" : "ffi clonefile wrong content");
process.exit(back === "hello\n" ? 0 : 1);
```

- [ ] **Step 2: Run it from source**

Run: `bun <scratchpad>/ffi-check/clone.ts`
Expected: `ffi clonefile ok`, exit 0.

- [ ] **Step 3: Compile and sign with the release entitlements under the hardened runtime**

Run:
```bash
cd <scratchpad>/ffi-check
bun build --compile clone.ts --outfile clone-bin
codesign --force --sign - --options runtime --entitlements <repo>/scripts/entitlements.plist clone-bin
codesign -dvv clone-bin 2>&1 | grep -E "runtime|flags"
```
Expected: `flags=0x10000(runtime)` in the codesign output. Ad-hoc identity (`-`) with `--options runtime` enforces the same hardened-runtime rules as the Developer ID signature.

- [ ] **Step 4: Run the signed binary under an isolated HOME**

Run: `env -i HOME=$(mktemp -d) PATH=/usr/bin:/bin ./clone-bin`
Expected: `ffi clonefile ok`, exit 0. Any `Code Signature Invalid`, `SIGKILL`, or `dlopen` failure is a **no-go**.

- [ ] **Step 5: Record the outcome and commit the plan**

Edit the line below in this file, then:
```bash
git add docs/superpowers/plans/2026-09-21-golden-worktree-hydration.md
git commit -m "plan: record bun:ffi clonefile hardened-runtime check"
```

**Outcome:** (unrecorded)

---

### Task 2: `golden` tree kind and its root path

**Files:**
- Modify: `lib/worktree/registry.ts:5` (`TreeKind`), `lib/worktree/registry.ts:186` (`MANAGED_KINDS`)
- Modify: `lib/rt-paths.ts` (after `worktreePoolRoot`, line 152)
- Test: `lib/worktree/__tests__/registry-critical.test.ts` (append), `lib/__tests__/rt-paths.test.ts` (append; create if absent)

**Interfaces:**
- Produces: `TreeKind` gains `"golden"`; `goldenRoot(serializedIdentity: string): string` in `lib/rt-paths.ts` returning `join(rtDir(), "golden", worktreePoolSegment(serializedIdentity))`; constants `GOLDEN_NAME = "golden"` and `GOLDEN_BRANCH = "golden"` exported from `lib/worktree/registry.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/worktree/__tests__/registry-critical.test.ts`:

```ts
import { GOLDEN_BRANCH, GOLDEN_NAME, type TreeKind } from "../registry.ts";

describe("golden kind", () => {
  test("golden is a TreeKind and has fixed name/branch", () => {
    const k: TreeKind = "golden";
    expect(k).toBe("golden");
    expect(GOLDEN_NAME).toBe("golden");
    expect(GOLDEN_BRANCH).toBe("golden");
  });

  test("a golden record beats a newer unmanaged challenger for the same path", () => {
    const held: TreeRecord = { name: "golden", path: "/p", kind: "golden", branch: "golden", createdAt: "2026-01-01T00:00:00.000Z", readyStamp: "abc" };
    const challenger: TreeRecord = { name: "p", path: "/p", kind: "unmanaged", branch: null, createdAt: "2026-02-01T00:00:00.000Z" };
    const merged = mergeRegistries([held], [challenger]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.kind).toBe("golden");
  });
});
```
`mergeRegistries` is the dedupe seam; `saveRegistry` writes the array verbatim, so asserting through save/load would pass or fail for the wrong reason. Import `mergeRegistries` and `TreeRecord` from `../registry.ts`; the file's existing HOME/`closeStateDb` `beforeEach` still applies.

Append to `lib/__tests__/rt-paths.test.ts`:

```ts
import { goldenRoot, worktreePoolRoot, rtDir } from "../rt-paths.ts";

describe("goldenRoot", () => {
  test("lives under <rtDir>/golden with the same segment as the pool root", () => {
    const id = "github.com/m4ttstack/rt";
    const seg = worktreePoolRoot(id).split("/").pop();
    expect(goldenRoot(id)).toBe(`${rtDir()}/golden/${seg}`);
    expect(goldenRoot(id).startsWith(worktreePoolRoot(id))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/worktree/__tests__/registry-critical.test.ts lib/__tests__/rt-paths.test.ts`
Expected: FAIL (`GOLDEN_NAME` not exported; `goldenRoot` not exported; the dedupe test may fail on kind).

- [ ] **Step 3: Implement**

`lib/worktree/registry.ts`:
```ts
export type TreeKind = "main" | "ephemeral" | "unmanaged" | "golden";
export const GOLDEN_NAME = "golden";
export const GOLDEN_BRANCH = "golden";
```
and update the now-stale field comment on `TreeRecord.state` (line 13) from `// ephemeral only` to `// ephemeral and golden only`.
and
```ts
const MANAGED_KINDS: ReadonlySet<TreeKind> = new Set<TreeKind>(["main", "ephemeral", "golden"]);
```

`lib/rt-paths.ts`, after `worktreePoolRoot`:
```ts
/** golden/<same PATH-safe segment as the pool root>: the hydration donor, kept out of the pool listing. */
export function goldenRoot(serializedIdentity: string): string {
  return join(rtDir(), "golden", worktreePoolSegment(serializedIdentity));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/worktree/__tests__/registry-critical.test.ts lib/__tests__/rt-paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the typecheck and commit**

Run: `bunx tsc --noEmit` (the command CI runs; there is no `typecheck` npm script)
Expected: clean.

```bash
git add lib/worktree/registry.ts lib/rt-paths.ts lib/worktree/__tests__/registry-critical.test.ts lib/__tests__/rt-paths.test.ts
git commit -m "worktree: add golden tree kind and goldenRoot path"
```

---

### Task 3: `clonefile` wrapper

**Files:**
- Create: `lib/worktree/clonefile.ts`
- Test: `lib/worktree/__tests__/clonefile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CloneResult = { ok: true } | { ok: false; errno: number; message: string };
  export function clonePath(src: string, dst: string): CloneResult;
  export const CLONE_EXIT = { ok: 0, other: 1, usage: 2, exdev: 3, notsup: 4, exist: 5 } as const;
  export function cloneExitCode(r: CloneResult): number;
  ```
  Darwin errnos used: `EEXIST = 17`, `EXDEV = 18`, `ENOTSUP = 45`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/worktree/__tests__/clonefile.test.ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clonePath, cloneExitCode, CLONE_EXIT } from "../clonefile.ts";

function fixture(): { dir: string; src: string } {
  const dir = mkdtempSync(join(tmpdir(), "rtclone-"));
  const src = join(dir, "src");
  mkdirSync(join(src, "nested", "deep"), { recursive: true });
  writeFileSync(join(src, "nested", "deep", "a.txt"), "alpha\n");
  writeFileSync(join(src, "b.txt"), "beta\n");
  return { dir, src };
}

describe("clonePath", () => {
  test("clones a directory tree; contents match, inodes differ, writes do not leak back", () => {
    const { dir, src } = fixture();
    const dst = join(dir, "dst");
    const r = clonePath(src, dst);
    expect(r).toEqual({ ok: true });
    expect(readFileSync(join(dst, "nested", "deep", "a.txt"), "utf8")).toBe("alpha\n");
    expect(statSync(join(dst, "b.txt")).ino).not.toBe(statSync(join(src, "b.txt")).ino);
    writeFileSync(join(dst, "b.txt"), "changed\n");
    expect(readFileSync(join(src, "b.txt"), "utf8")).toBe("beta\n");
  });

  test("clones a single file", () => {
    const { dir, src } = fixture();
    const r = clonePath(join(src, "b.txt"), join(dir, "b-copy.txt"));
    expect(r).toEqual({ ok: true });
    expect(readFileSync(join(dir, "b-copy.txt"), "utf8")).toBe("beta\n");
  });

  test("an existing destination is EEXIST and maps to exit 5", () => {
    const { dir, src } = fixture();
    const dst = join(dir, "dst");
    mkdirSync(dst);
    const r = clonePath(src, dst);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errno).toBe(17);
    expect(cloneExitCode(r)).toBe(CLONE_EXIT.exist);
  });

  test("a missing source is ENOENT and maps to exit 1", () => {
    const { dir } = fixture();
    const r = clonePath(join(dir, "nope"), join(dir, "dst"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errno).toBe(2);
    expect(r.message.length).toBeGreaterThan(0);
    expect(cloneExitCode(r)).toBe(CLONE_EXIT.other);
    expect(existsSync(join(dir, "dst"))).toBe(false);
  });

  test("exit code table", () => {
    expect(cloneExitCode({ ok: true })).toBe(0);
    expect(cloneExitCode({ ok: false, errno: 18, message: "x" })).toBe(CLONE_EXIT.exdev);
    expect(cloneExitCode({ ok: false, errno: 45, message: "x" })).toBe(CLONE_EXIT.notsup);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/worktree/__tests__/clonefile.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// lib/worktree/clonefile.ts
/**
 * One clonefile(2) call. On APFS the kernel clones a whole directory
 * subtree copy-on-write in a single syscall; `cp -c` walks and clones file
 * by file and was measured 12x slower on 580k inodes. The call blocks the
 * calling thread for the duration, so it only ever runs in the child
 * process behind `rt worktree hydrate-clone`, never on the daemon thread.
 */
import { dlopen, FFIType, ptr, read } from "bun:ffi";

export type CloneResult = { ok: true } | { ok: false; errno: number; message: string };

export const CLONE_EXIT = { ok: 0, other: 1, usage: 2, exdev: 3, notsup: 4, exist: 5 } as const;

const EEXIST = 17;
const EXDEV = 18;
const ENOTSUP = 45;

let lib: ReturnType<typeof open> | null = null;
function open() {
  return dlopen("/usr/lib/libSystem.B.dylib", {
    clonefile: { args: [FFIType.cstring, FFIType.cstring, FFIType.u32], returns: FFIType.i32 },
    __error: { args: [], returns: FFIType.ptr },
    strerror: { args: [FFIType.i32], returns: FFIType.cstring },
  });
}

function cstr(s: string) {
  return ptr(Buffer.from(`${s}\0`));
}

export function clonePath(src: string, dst: string): CloneResult {
  lib ??= open();
  const rc = lib.symbols.clonefile(cstr(src), cstr(dst), 0);
  if (rc === 0) return { ok: true };
  const errno = read.i32(lib.symbols.__error()!, 0);
  const message = String(lib.symbols.strerror(errno) ?? `errno ${errno}`);
  return { ok: false, errno, message };
}

export function cloneExitCode(r: CloneResult): number {
  if (r.ok) return CLONE_EXIT.ok;
  if (r.errno === EXDEV) return CLONE_EXIT.exdev;
  if (r.errno === ENOTSUP) return CLONE_EXIT.notsup;
  if (r.errno === EEXIST) return CLONE_EXIT.exist;
  return CLONE_EXIT.other;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/worktree/__tests__/clonefile.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/worktree/clonefile.ts lib/worktree/__tests__/clonefile.test.ts
git commit -m "worktree: clonefile(2) wrapper with exit-code table"
```

---

### Task 4: Hidden verb `rt worktree hydrate-clone <src> <dst>`

**Files:**
- Modify: `commands/worktree.ts` (append export)
- Modify: `lib/command-tree-def.ts` (inside the `worktree` `subcommands` map that starts at line 1175)
- Test: `commands/__tests__/worktree-hydrate-clone.test.ts`
- Test: `e2e/tests/worktree-hydrate-clone.test.ts`

**Interfaces:**
- Consumes: `clonePath`, `cloneExitCode`, `CLONE_EXIT` from Task 3.
- Produces: `export async function worktreeHydrateClone(args: string[], _ctx: unknown): Promise<void>`; process contract: argv `["<src>", "<dst>"]`, exit `0` cloned, `2` usage (also when `src === dst`), `3` EXDEV, `4` ENOTSUP, `5` EEXIST, `1` other; stderr `clonefile: <message>` on failure, nothing on stdout.

- [ ] **Step 1: Write the failing unit test**

```ts
// commands/__tests__/worktree-hydrate-clone.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { worktreeHydrateClone } from "../worktree.ts";

const realExit = process.exit;
let exitCode: number | undefined;
let stderr = "";
const realErr = console.error;

function arm() {
  exitCode = undefined;
  stderr = "";
  process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error("__exit__"); }) as never;
  console.error = (...a: unknown[]) => { stderr += a.join(" ") + "\n"; };
}
afterEach(() => { process.exit = realExit; console.error = realErr; });

async function run(args: string[]): Promise<number | undefined> {
  arm();
  try { await worktreeHydrateClone(args, {}); } catch (e) { if ((e as Error).message !== "__exit__") throw e; }
  return exitCode;
}

describe("worktreeHydrateClone", () => {
  test("usage exit 2 on missing args or src === dst", async () => {
    expect(await run([])).toBe(2);
    expect(await run(["/a"])).toBe(2);
    expect(await run(["/a", "/a"])).toBe(2);
  });

  test("clones and exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rthc-"));
    mkdirSync(join(dir, "src", "n"), { recursive: true });
    writeFileSync(join(dir, "src", "n", "f"), "x");
    expect(await run([join(dir, "src"), join(dir, "dst")])).toBe(0);
    expect(existsSync(join(dir, "dst", "n", "f"))).toBe(true);
  });

  test("EEXIST exits 5 with a clonefile: line on stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rthc-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "dst"));
    expect(await run([join(dir, "src"), join(dir, "dst")])).toBe(5);
    expect(stderr).toMatch(/^clonefile: /m);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test commands/__tests__/worktree-hydrate-clone.test.ts`
Expected: FAIL, `worktreeHydrateClone` is not exported.

- [ ] **Step 3: Implement the command**

Append to `commands/worktree.ts`:

```ts
import { clonePath, cloneExitCode, CLONE_EXIT } from "../lib/worktree/clonefile.ts";

/** Child-process body for hydration: one clonefile(2) of <src> at <dst>. Exit codes are the daemon's contract; see lib/worktree/clonefile.ts. */
export async function worktreeHydrateClone(args: string[], _ctx: unknown): Promise<void> {
  const [src, dst] = args.filter((a) => !a.startsWith("--"));
  if (!src || !dst || src === dst) {
    console.error("usage: rt worktree hydrate-clone <src> <dst>");
    process.exit(CLONE_EXIT.usage);
  }
  const r = clonePath(src, dst);
  if (!r.ok) console.error(`clonefile: ${r.message}`);
  process.exit(cloneExitCode(r));
}
```
(Put the import with the file's other imports at the top.)

Add to the `worktree` `subcommands` map in `lib/command-tree-def.ts`, next to `provision`:

```ts
      "hydrate-clone": {
        description: "Hidden verb the daemon spawns to clonefile(2) a golden tree's artifacts into a new member; never call directly",
        module: "./commands/worktree.ts",
        fn: "worktreeHydrateClone",
        hidden: true,
        omitBehavior: { exempt: "daemon-facing by contract; src and dst are arbitrary paths" },
        args: [
          { name: "Source", type: "text", placeholder: "/path/to/golden/node_modules", hint: "Path to clone from" },
          { name: "Destination", type: "text", placeholder: "/path/to/member/node_modules", hint: "Path to create" },
        ],
      },
```
Match the positional-arg shape other nodes in this file use for flagless text args (look at `dispose`'s `Tree` arg for the exact field set).

- [ ] **Step 4: Run unit test and picker conformance**

Run: `bun test commands/__tests__/worktree-hydrate-clone.test.ts && bun run picker:check`
Expected: PASS; conformance clean.

- [ ] **Step 5: Write the e2e contract test**

```ts
// e2e/tests/worktree-hydrate-clone.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createTestHome, rt } from "../harness.ts";

let home: { path: string; cleanup: () => void };
beforeAll(() => { home = createTestHome(); });
afterAll(() => home.cleanup());

describe("rt worktree hydrate-clone", () => {
  test("usage exits 2 and prints nothing on stdout", async () => {
    const res = await rt(["worktree", "hydrate-clone"], { home: home.path });
    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("usage: rt worktree hydrate-clone <src> <dst>");
  });

  test("clones a directory and exits 0", async () => {
    const src = join(home.path, "src");
    mkdirSync(join(src, "n"), { recursive: true });
    writeFileSync(join(src, "n", "f.txt"), "ok\n");
    const res = await rt(["worktree", "hydrate-clone", src, join(home.path, "dst")], { home: home.path });
    expect(res.exitCode).toBe(0);
    expect(existsSync(join(home.path, "dst", "n", "f.txt"))).toBe(true);
  });

  test("existing destination exits 5", async () => {
    mkdirSync(join(home.path, "s2"));
    mkdirSync(join(home.path, "d2"));
    const res = await rt(["worktree", "hydrate-clone", join(home.path, "s2"), join(home.path, "d2")], { home: home.path });
    expect(res.exitCode).toBe(5);
    expect(res.stderr).toMatch(/clonefile: /);
  });
});
```

- [ ] **Step 6: Run the e2e file**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/worktree-hydrate-clone.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add commands/worktree.ts lib/command-tree-def.ts commands/__tests__/worktree-hydrate-clone.test.ts e2e/tests/worktree-hydrate-clone.test.ts
git commit -m "worktree: hidden hydrate-clone verb wrapping clonefile"
```

---

### Task 5: `createTree` can build the golden

**Files:**
- Modify: `lib/worktree/create.ts:36-95`
- Test: `lib/worktree/__tests__/create.test.ts` (append)

**Interfaces:**
- Consumes: `GOLDEN_NAME`, `GOLDEN_BRANCH`, `goldenRoot` (Task 2).
- Produces: `CreateDeps` gains `target?: "member" | "golden"` (default `"member"`). With `"golden"`: `name = GOLDEN_NAME`, `path = goldenRoot(repoName)`, `kind = "golden"`, `branch = GOLDEN_BRANCH`. Everything else (registry-first row, fetch, `worktree add`, ready ladder, `readyStamp`, `state: "on-deck"`, `worktree:created`) is identical.

- [ ] **Step 1: Write the failing test**

Append inside `describe("createTree", ...)` in `lib/worktree/__tests__/create.test.ts`:

```ts
  test("target golden: fixed name, goldenRoot path, golden branch, kind golden, ready like a member", async () => {
    const expectedSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();
    const deps = { ...makeDeps(repoName, repo, events), target: "golden" as const };

    const result = await createTree(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tree.kind).toBe("golden");
    expect(result.tree.name).toBe("golden");
    expect(result.tree.branch).toBe("golden");
    expect(result.tree.state).toBe("on-deck");
    expect(result.tree.readyStamp).toBe(expectedSha);
    expect(result.tree.path).toBe(goldenRoot(repoName));
    expect(result.tree.path.startsWith(join(repo, ".worktrees"))).toBe(false);

    const worktrees = (await listWorktreesAsync(repo))!;
    expect(worktrees.find((w) => w.path === result.tree.path)?.branch).toBe("golden");
  });
```
Add `import { goldenRoot } from "../../rt-paths.ts";` to the test imports. `createTree` derives the golden path as `goldenRoot(repoName)` from the `repoName` it is handed, so the test compares against the same call.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/worktree/__tests__/create.test.ts -t "target golden"`
Expected: FAIL (`target` ignored; kind is `ephemeral`).

- [ ] **Step 3: Implement**

In `lib/worktree/create.ts`:

```ts
import { GOLDEN_BRANCH, GOLDEN_NAME, loadRegistry, saveRegistry, usedNames, type TreeKind, type TreeRecord } from "./registry.ts";
import { goldenRoot } from "../rt-paths.ts";

export interface CreateDeps {
  repoName: string;
  repoPath: string;
  emit: (type: string, data: unknown) => void;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  /** "golden" builds the hydration donor at goldenRoot with a fixed name; default is a pool member. */
  target?: "member" | "golden";
}
```

In `createTree`, replace the name/path lines:
```ts
  const golden = deps.target === "golden";
  const name = golden ? GOLDEN_NAME : pickName(cfg.namePool, usedNames(existing));
  const path = golden ? goldenRoot(repoName) : join(cfg.root, name);
```
Keep the `rootInsideRepo` block as is (it reads `cfg.root`; the golden root is never inside the repo).

In `runCreate`, replace the `branch` and `rec` lines:
```ts
  const golden = deps.target === "golden";
  const branch = golden ? GOLDEN_BRANCH : `on-deck/${name}`;
  const kind: TreeKind = golden ? "golden" : "ephemeral";

  const rec: TreeRecord = {
    name,
    path,
    kind,
    state: "creating",
    branch,
    createdAt: new Date().toISOString(),
  };
```
No other change: `state: "on-deck"` at the end is the readiness meaning for both kinds.

- [ ] **Step 4: Run the whole create suite**

Run: `bun test lib/worktree/__tests__/create.test.ts`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/worktree/create.ts lib/worktree/__tests__/create.test.ts
git commit -m "worktree: createTree target golden"
```

---

### Task 6: `hydrateTree`

**Files:**
- Create: `lib/worktree/hydrate.ts`
- Test: `lib/worktree/__tests__/hydrate.test.ts`

**Interfaces:**
- Consumes: `CreateDeps`, `scrapTree` (`lib/worktree/create.ts`), `runGit`, `listWorktreesAsync` (`lib/worktree/git-async.ts`), `loadRegistry`/`saveRegistry`/`usedNames`/`TreeRecord` (`registry.ts`), `pickName` (`names.ts`), `loadWorktreeRepoConfig` (`config.ts`), `withTreeLock` (`locks.ts`), `runCapture` (`lib/subprocess.ts`), `rtBinaryPath` (`lib/dev-mode.ts`), `reconcileForRepo` (`lib/daemon/doppler-sync.ts`), `deriveRepoIdentity` (`lib/settings/identity.ts`).
- Produces:
  ```ts
  export type CloneRunner = (src: string, dst: string) => Promise<{ exitCode: number; stderr: string }>;
  export const defaultCloneRunner: CloneRunner; // runCapture([rtBinaryPath(), "worktree", "hydrate-clone", src, dst], { timeoutMs: 15 * 60_000, stderr: "pipe" })
  export function parseIgnoredPaths(porcelainZ: string): string[]; // NUL-separated records, "!! " prefix, trailing "/" stripped, drops *.log and paths under ".git"
  export async function listIgnoredPaths(treePath: string): Promise<string[] | null>; // git status --ignored --porcelain -z; null on git failure
  export type HydrateResult =
    | { ok: true; tree: TreeRecord }
    | { ok: false; error: "busy" }
    | { ok: false; error: "hydrate-unavailable"; detail: string }   // exit 3 or 4 from the clone verb
    | { ok: false; error: "create-failed"; failedStep: string; output: string };
  export async function hydrateTree(deps: CreateDeps & { golden: TreeRecord; clone?: CloneRunner }): Promise<HydrateResult>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/worktree/__tests__/hydrate.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../../state/index.ts";
import { loadRegistry, type TreeRecord } from "../registry.ts";
import { listWorktreesAsync } from "../git-async.ts";
import { createTree, type CreateDeps } from "../create.ts";
import { hydrateTree, parseIgnoredPaths, listIgnoredPaths, type CloneRunner } from "../hydrate.ts";
import { clonePath, cloneExitCode } from "../clonefile.ts";

// Same repo/identity helpers as create.test.ts; copy makeRepo, addBareOrigin,
// declareWorktrees and makeDeps from that file verbatim.

const inProcessClone: CloneRunner = async (src, dst) => {
  const r = clonePath(src, dst);
  return { exitCode: cloneExitCode(r), stderr: r.ok ? "" : `clonefile: ${r.message}` };
};

describe("parseIgnoredPaths", () => {
  test("keeps !! records, strips trailing slash, drops logs and .git", () => {
    const out = [
      "!! node_modules/",
      "!! apps/backend/generated/",
      "!! apps/backend/newrelic_agent.log",
      "!! packages/x/tsconfig.tsbuildinfo",
      "?? untracked.txt",
      " M tracked.ts",
      "!! .git/hooks-cache/",
    ].join("\0") + "\0";
    expect(parseIgnoredPaths(out)).toEqual([
      "node_modules",
      "apps/backend/generated",
      "packages/x/tsconfig.tsbuildinfo",
    ]);
  });

  test("a path with a space survives verbatim (porcelain v1 would C-quote it)", () => {
    expect(parseIgnoredPaths("!! apps/my app/generated/\0")).toEqual(["apps/my app/generated"]);
  });
});

describe("hydrateTree", () => {
  let repo: string;
  let repoName: string;
  let events: Array<{ type: string; data: unknown }>;
  let golden: TreeRecord;

  beforeEach(async () => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rthydrate-home-")));
    closeStateDb();
    repo = makeRepo();
    addBareOrigin(repo);
    repoName = "acme";
    events = [];
    writeFileSync(join(repo, ".gitignore"), "node_modules/\ngenerated/\n*.log\n");
    execSync("git add .gitignore && git -c user.email=t@t -c user.name=t commit -qm gitignore && git push -q origin HEAD", { cwd: repo, shell: "/bin/zsh" });
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [] });
    const made = await createTree({ ...makeDeps(repoName, repo, events), target: "golden" });
    if (!made.ok) throw new Error("golden create failed");
    golden = made.tree;
    mkdirSync(join(golden.path, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(golden.path, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
    mkdirSync(join(golden.path, "generated"));
    writeFileSync(join(golden.path, "generated", "types.ts"), "export type T = 1;\n");
    writeFileSync(join(golden.path, "debug.log"), "noise\n");
  });

  test("listIgnoredPaths on the golden returns its artifact set", async () => {
    const paths = await listIgnoredPaths(golden.path);
    expect(paths).toEqual(["generated", "node_modules"]);
  });

  test("happy path: member at golden sha, artifacts cloned, stamps inherited, no ready step run", async () => {
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden, clone: inProcessClone });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = result.tree;
    expect(t.kind).toBe("ephemeral");
    expect(t.state).toBe("on-deck");
    expect(t.branch).toBe(`on-deck/${t.name}`);
    expect(t.readyStamp).toBe(golden.readyStamp);
    expect(t.readyAt).toBe(golden.readyAt);
    expect(readFileSync(join(t.path, "node_modules", "pkg", "index.js"), "utf8")).toBe("module.exports = 1;\n");
    expect(readFileSync(join(t.path, "generated", "types.ts"), "utf8")).toBe("export type T = 1;\n");
    expect(existsSync(join(t.path, "debug.log"))).toBe(false);
    const head = execSync("git rev-parse HEAD", { cwd: t.path, encoding: "utf8" }).trim();
    expect(head).toBe(golden.readyStamp);
    const wt = (await listWorktreesAsync(repo))!.find((w) => w.path === t.path);
    expect(wt?.branch).toBe(`on-deck/${t.name}`);
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(1);
    expect(events.some((e) => e.type === "worktree:created")).toBe(true);
  });

  test("clone exit 3 reports hydrate-unavailable and scraps the half-built tree", async () => {
    const exdev: CloneRunner = async () => ({ exitCode: 3, stderr: "clonefile: Cross-device link" });
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden, clone: exdev });
    expect(result).toEqual({ ok: false, error: "hydrate-unavailable", detail: "clonefile: Cross-device link" });
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
    const wts = (await listWorktreesAsync(repo))!;
    expect(wts.some((w) => w.branch?.startsWith("on-deck/"))).toBe(false);
  });

  test("clone exit 1 is create-failed with the step named and scraps", async () => {
    const boom: CloneRunner = async () => ({ exitCode: 1, stderr: "clonefile: Input/output error" });
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden, clone: boom });
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "create-failed") throw new Error("wrong shape");
    expect(result.failedStep).toBe("hydrate-clone node_modules");
    expect(result.output).toContain("Input/output error");
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
  });

  test("a golden without readyStamp is refused before any git mutation", async () => {
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden: { ...golden, readyStamp: undefined }, clone: inProcessClone });
    expect(result).toEqual({ ok: false, error: "hydrate-unavailable", detail: "golden has no readyStamp" });
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/worktree/__tests__/hydrate.test.ts`
Expected: FAIL, module `../hydrate.ts` not found.

- [ ] **Step 3: Implement**

```ts
// lib/worktree/hydrate.ts
/**
 * Hydrate: build an on-deck member from the golden tree instead of a cold
 * create. Same registry-first ordering and same scrap path as create.ts.
 * The member is born at the golden's readyStamp (not origin/<default>) and
 * inherits readyStamp/readyAt, so the next freshen pass owns catching it
 * up: `changed:` steps fire only if the ladder's inputs moved since.
 */
import { isAbsolute, join, relative, dirname } from "path";
import { mkdirSync } from "fs";
import { loadRegistry, saveRegistry, usedNames, type TreeRecord } from "./registry.ts";
import { runGit, listWorktreesAsync, ensureInfoExclude } from "./git-async.ts";
import { pickName } from "./names.ts";
import { loadWorktreeRepoConfig } from "./config.ts";
import { withTreeLock } from "./locks.ts";
import { scrapTree, type CreateDeps } from "./create.ts";
import { runCapture } from "../subprocess.ts";
import { rtBinaryPath } from "../dev-mode.ts";
import { reconcileForRepo } from "../daemon/doppler-sync.ts";
import { deriveRepoIdentity } from "../settings/identity.ts";

const ADD_TIMEOUT_MS = 5 * 60_000;
const CLONE_TIMEOUT_MS = 15 * 60_000;

export type CloneRunner = (src: string, dst: string) => Promise<{ exitCode: number; stderr: string }>;

export const defaultCloneRunner: CloneRunner = async (src, dst) => {
  const r = await runCapture([rtBinaryPath(), "worktree", "hydrate-clone", src, dst], {
    timeoutMs: CLONE_TIMEOUT_MS,
    stderr: "pipe",
  });
  return { exitCode: r.exitCode, stderr: r.stderr.trim() };
};

/**
 * `-z` records, not `--porcelain` lines: porcelain v1 C-quotes any path with a
 * space or a special byte, and a quoted path would be cloned to the wrong
 * place and fail every hydrate for that repo into permanent backoff.
 */
export function parseIgnoredPaths(porcelainZ: string): string[] {
  const out: string[] = [];
  for (const line of porcelainZ.split("\0")) {
    if (!line.startsWith("!! ")) continue;
    let p = line.slice(3);
    if (p.endsWith("/")) p = p.slice(0, -1);
    if (p.endsWith(".log") || p === ".git" || p.startsWith(".git/")) continue;
    out.push(p);
  }
  return out;
}

export async function listIgnoredPaths(treePath: string): Promise<string[] | null> {
  const r = await runGit(treePath, ["status", "--ignored", "--porcelain", "-z"]);
  if (r.exitCode !== 0) return null;
  return parseIgnoredPaths(r.stdout);
}

export type HydrateResult =
  | { ok: true; tree: TreeRecord }
  | { ok: false; error: "busy" }
  | { ok: false; error: "hydrate-unavailable"; detail: string }
  | { ok: false; error: "create-failed"; failedStep: string; output: string };

export async function hydrateTree(deps: CreateDeps & { golden: TreeRecord; clone?: CloneRunner }): Promise<HydrateResult> {
  const { repoName, repoPath, golden } = deps;
  if (!golden.readyStamp) return { ok: false, error: "hydrate-unavailable", detail: "golden has no readyStamp" };
  const clone = deps.clone ?? defaultCloneRunner;

  const cfg = await loadWorktreeRepoConfig(repoName, repoPath);
  const existing = loadRegistry(repoName);
  const name = pickName(cfg.namePool, usedNames(existing));
  const path = join(cfg.root, name);

  const rel = relative(repoPath, cfg.root);
  const rootInsideRepo = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  if (rootInsideRepo) await ensureInfoExclude(repoPath, `${rel.split("/")[0]}/`);

  const outcome = await withTreeLock(path, () => runHydrate(deps, clone, golden, name, path));
  if (outcome === "busy") return { ok: false, error: "busy" };
  return outcome;
}

async function runHydrate(
  deps: CreateDeps,
  clone: CloneRunner,
  golden: TreeRecord,
  name: string,
  path: string,
): Promise<HydrateResult> {
  const { repoName, repoPath, emit, log } = deps;
  const branch = `on-deck/${name}`;
  const rec: TreeRecord = { name, path, kind: "ephemeral", state: "creating", branch, createdAt: new Date().toISOString() };

  const trees = loadRegistry(repoName);
  trees.push(rec);
  saveRegistry(repoName, trees);

  const fail = async (failedStep: string, output: string): Promise<HydrateResult> => {
    log.warn({ repo: repoName, tree: name, failedStep, output }, "worktree hydrate failed");
    await scrapTree(deps, rec);
    return { ok: false, error: "create-failed", failedStep, output };
  };
  const unavailable = async (detail: string): Promise<HydrateResult> => {
    log.warn({ repo: repoName, tree: name, detail }, "worktree hydrate unavailable; caller falls back to cold create");
    await scrapTree(deps, rec);
    return { ok: false, error: "hydrate-unavailable", detail };
  };

  const add = await runGit(repoPath, ["worktree", "add", "-b", branch, path, golden.readyStamp!], { timeoutMs: ADD_TIMEOUT_MS });
  if (add.exitCode !== 0) return fail(`git worktree add -b ${branch} ${path} ${golden.readyStamp}`, add.stdout + add.stderr);

  const gitEntries = await listWorktreesAsync(repoPath);
  if (gitEntries !== null) {
    const derived = await deriveRepoIdentity(repoPath);
    await reconcileForRepo({ repoIdentity: derived.kind === "remote" ? derived.id : null, worktreeRoots: gitEntries.map((w) => w.path) });
  }

  const artifacts = await listIgnoredPaths(golden.path);
  if (artifacts === null) return fail("git status --ignored -z (golden)", "git status failed on the golden tree");

  for (const relPath of artifacts) {
    const src = join(golden.path, relPath);
    const dst = join(path, relPath);
    mkdirSync(dirname(dst), { recursive: true });
    const r = await clone(src, dst);
    if (r.exitCode === 0) continue;
    if (r.exitCode === 3 || r.exitCode === 4) return unavailable(r.stderr);
    return fail(`hydrate-clone ${relPath}`, r.stderr);
  }

  const updated: TreeRecord = {
    ...rec,
    state: "on-deck",
    readyStamp: golden.readyStamp,
    ...(golden.readyAt ? { readyAt: golden.readyAt } : {}),
  };
  const finalTrees = loadRegistry(repoName).map((t) => (t.path === path ? updated : t));
  if (!saveRegistry(repoName, finalTrees)) {
    log.warn({ repo: repoName, tree: name, path }, "worktree hydrate: final registry flip dropped; leaving row creating");
    return { ok: false, error: "create-failed", failedStep: "registry-flip", output: "" };
  }

  emit("worktree:created", { repo: repoName, tree: name, path, hydratedFrom: golden.name });
  log.info({ repo: repoName, tree: name, path, golden: golden.name }, "worktree hydrated from golden");
  return { ok: true, tree: updated };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/worktree/__tests__/hydrate.test.ts`
Expected: PASS (6 tests). If `git worktree add ... <sha>` complains about a detached sha with `-b`, it should not: `-b <branch> <path> <commit-ish>` creates the branch at that commit.

- [ ] **Step 5: Commit**

```bash
git add lib/worktree/hydrate.ts lib/worktree/__tests__/hydrate.test.ts
git commit -m "worktree: hydrateTree builds a member from the golden by clonefile"
```

---

### Task 7: Replenish ensures the golden and hydrates members

**Files:**
- Modify: `lib/daemon/reconciler/replenish.ts:102-200`
- Test: `lib/daemon/reconciler/__tests__/replenish.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `createTree` with `target: "golden"` (Task 5); `hydrateTree`, `CloneRunner` (Task 6); `goldenRoot` (Task 2); `scrapTree` (`create.ts`).
- Produces:
  ```ts
  export function findGolden(trees: TreeRecord[]): TreeRecord | undefined; // kind === "golden"
  export type CreateMode = { mode: "hydrate"; golden: TreeRecord } | { mode: "cold"; why: string };
  export function chooseCreateMode(trees: TreeRecord[], cfgRoot: string, now: number, sameVolume: (a: string, b: string) => boolean): CreateMode;
  ```
  `replenishAndShrink` gains an optional `clone?: CloneRunner` on its deps (tests inject the in-process runner) and an optional `sameVolume?: (a, b) => boolean` (default compares `statSync(...).dev`, falling back to `false` if either path is missing).

- [ ] **Step 1: Write the failing tests**

Append to `lib/daemon/reconciler/__tests__/replenish.test.ts`:

```ts
import { chooseCreateMode, findGolden } from "../replenish.ts";
import { clonePath, cloneExitCode } from "../../../worktree/clonefile.ts";
import type { CloneRunner } from "../../../worktree/hydrate.ts";
import { goldenRoot } from "../../../rt-paths.ts";
import { loadRegistry } from "../../../worktree/registry.ts";

const inProcessClone: CloneRunner = async (src, dst) => {
  const r = clonePath(src, dst);
  return { exitCode: cloneExitCode(r), stderr: r.ok ? "" : `clonefile: ${r.message}` };
};

describe("replenish.ts: chooseCreateMode", () => {
  const now = Date.parse("2026-09-21T12:00:00.000Z");
  const same = () => true;
  const golden: TreeRecord = { name: "golden", path: "/g", kind: "golden", state: "on-deck", branch: "golden", createdAt: "2026-09-01T00:00:00.000Z", readyStamp: "abc", readyAt: "2026-09-01T00:10:00.000Z" };

  test("ready golden on the same volume hydrates", () => {
    expect(chooseCreateMode([golden], "/pool", now, same)).toEqual({ mode: "hydrate", golden });
  });
  test("no golden is cold", () => {
    expect(chooseCreateMode([], "/pool", now, same)).toEqual({ mode: "cold", why: "no golden" });
  });
  test("creating golden is cold", () => {
    expect(chooseCreateMode([{ ...golden, state: "creating" }], "/pool", now, same).mode).toBe("cold");
  });
  test("golden in backoff is cold", () => {
    expect(chooseCreateMode([{ ...golden, nextRetryAt: "2026-09-21T13:00:00.000Z" }], "/pool", now, same).mode).toBe("cold");
  });
  test("golden without readyStamp is cold", () => {
    expect(chooseCreateMode([{ ...golden, readyStamp: undefined }], "/pool", now, same).mode).toBe("cold");
  });
  test("a golden with recorded failures is cold even with no live backoff deadline", () => {
    expect(chooseCreateMode([{ ...golden, retryFailures: 1 }], "/pool", now, same).mode).toBe("cold");
  });
  test("different volume is cold", () => {
    expect(chooseCreateMode([golden], "/pool", now, () => false)).toEqual({ mode: "cold", why: "golden and pool root are on different volumes" });
  });
});

describe("replenish.ts: golden lifecycle", () => {
  const repoName = "acme";
  let repo: string;
  let priorHome: string | undefined;

  beforeEach(() => {
    priorHome = process.env.HOME;
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rtgolden-home-")));
    closeStateDb();
    createBackoff.clear();
    repo = makeRepo();
    addBareOrigin(repo);
  });
  afterEach(() => {
    closeStateDb();
    if (priorHome !== undefined) process.env.HOME = priorHome;
  });

  function deps(clone: CloneRunner = inProcessClone) {
    return { repoName, repoPath: repo, emit: () => {}, log: fakeLog(), findRunningRun: () => ({ kind: "none" as const }), clone };
  }

  test("first pass builds the golden, then fills onDeck by hydration", async () => {
    await declareWorktrees(repo, repoName, { onDeck: 2, root: join(repo, ".worktrees"), ready: [] });
    await replenishAndShrink(deps(), new Map(), fakeAppConfig());
    const trees = loadRegistry(repoName);
    const golden = findGolden(trees);
    expect(golden?.state).toBe("on-deck");
    expect(golden?.readyStamp).toBeTruthy();
    const members = trees.filter((t) => t.kind === "ephemeral" && t.state === "on-deck");
    expect(members).toHaveLength(2);
    for (const m of members) {
      expect(m.readyStamp).toBe(golden!.readyStamp);
      expect(m.readyAt).toBe(golden!.readyAt);
    }
  });

  test("a golden create failure backs off and members still cold-create", async () => {
    // createTree keys the golden path off the repoName it is handed, verbatim,
    // so the gate script must be built from that same call, not from a
    // re-derived identity.
    const gRoot = goldenRoot(repoName);
    await declareWorktrees(repo, repoName, {
      onDeck: 1,
      root: join(repo, ".worktrees"),
      ready: [{ run: `case "$PWD" in ${gRoot}*) exit 1;; *) exit 0;; esac` }],
    });
    const backoff = new Map<string, { failures: number; nextRetryAt: string }>();
    await replenishAndShrink({ ...deps(), backoff }, new Map(), fakeAppConfig());
    const trees = loadRegistry(repoName);
    expect(findGolden(trees)).toBeUndefined();
    expect(trees.filter((t) => t.kind === "ephemeral" && t.state === "on-deck")).toHaveLength(1);
    expect(backoff.get(`${repoName}#golden`)?.failures).toBe(1);
  });

  test("hydrate-unavailable falls back to cold create in the same pass", async () => {
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [] });
    const exdev: CloneRunner = async () => ({ exitCode: 3, stderr: "clonefile: Cross-device link" });
    await replenishAndShrink(deps(exdev), new Map(), fakeAppConfig());
    const trees = loadRegistry(repoName);
    expect(findGolden(trees)?.state).toBe("on-deck");
    expect(trees.filter((t) => t.kind === "ephemeral" && t.state === "on-deck")).toHaveLength(1);
  });

  test("onDeck 0 scraps the golden and nothing else", async () => {
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [] });
    await replenishAndShrink(deps(), new Map(), fakeAppConfig());
    expect(findGolden(loadRegistry(repoName))).toBeDefined();
    await declareWorktrees(repo, repoName, { onDeck: 0, root: join(repo, ".worktrees"), ready: [] });
    await replenishAndShrink(deps(), new Map(), fakeAppConfig());
    const trees = loadRegistry(repoName);
    expect(findGolden(trees)).toBeUndefined();
    expect(trees.filter((t) => t.kind === "ephemeral" && t.state === "on-deck")).toHaveLength(1);
  });
});
```
The golden's backoff key is `${repoName}#golden` so a failing golden build never blocks member creates. The suite already imports `createBackoff`; keep using it in the new `beforeEach`.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/reconciler/__tests__/replenish.test.ts -t "chooseCreateMode|golden lifecycle"`
Expected: FAIL (`chooseCreateMode`/`findGolden` not exported).

- [ ] **Step 3: Implement**

In `lib/daemon/reconciler/replenish.ts`:

```ts
import { statSync } from "fs";
import { createTree, scrapTree } from "../../worktree/create.ts";
import { hydrateTree, type CloneRunner } from "../../worktree/hydrate.ts";
import { goldenRoot } from "../../rt-paths.ts";

export function findGolden(trees: TreeRecord[]): TreeRecord | undefined {
  return trees.find((t) => t.kind === "golden");
}

export type CreateMode = { mode: "hydrate"; golden: TreeRecord } | { mode: "cold"; why: string };

/** Pure: whether the next member build can be a hydration. Every "no" is a cold create, never a skipped build. */
export function chooseCreateMode(
  trees: TreeRecord[],
  cfgRoot: string,
  now: number,
  sameVolume: (a: string, b: string) => boolean,
): CreateMode {
  const golden = findGolden(trees);
  if (!golden) return { mode: "cold", why: "no golden" };
  if (golden.state !== "on-deck") return { mode: "cold", why: `golden is ${golden.state ?? "unstated"}` };
  if (golden.nextRetryAt && Date.parse(golden.nextRetryAt) > now) return { mode: "cold", why: "golden in backoff" };
  // retryFailures outlives nextRetryAt, so a golden whose ready ladder died is
  // refused as a donor even when its deadline has since passed and nothing has
  // re-freshened it. Without this the predicate would depend on the caller
  // running freshen first, which only the reconciler pass guarantees.
  if ((golden.retryFailures ?? 0) > 0) return { mode: "cold", why: "golden has recorded failures" };
  if (!golden.readyStamp) return { mode: "cold", why: "golden has no readyStamp" };
  if (!sameVolume(golden.path, cfgRoot)) return { mode: "cold", why: "golden and pool root are on different volumes" };
  return { mode: "hydrate", golden };
}

function sameDev(a: string, b: string): boolean {
  try {
    return statSync(a).dev === statSync(b).dev;
  } catch {
    return false;
  }
}
```

Extend `replenishAndShrink`'s deps type with `clone?: CloneRunner; sameVolume?: (a: string, b: string) => boolean;`.

Stat once per pass, not per member, and lazily: the golden root does not
exist until the ensure block above has run, and `sameDev` degrades to
`false` on a missing path, so a thunk evaluated eagerly would make every
member of a repo's first pass cold-create. Memoize on first call instead of
relying on where this sits relative to the ensure block:

```ts
  let volumeOk: boolean | undefined;
  const sameVolumeForPass = (a: string, b: string): boolean => {
    volumeOk ??= (deps.sameVolume ?? sameDev)(a, b);
    return volumeOk;
  };
```
`chooseCreateMode` only calls it once it has a golden in hand, so the first
call always happens after the golden exists on disk. Pass
`sameVolumeForPass` into `chooseCreateMode` below.

Replace the early return `if (onDeck <= 0) return;` with:
```ts
  if (onDeck <= 0) {
    const golden = findGolden(loadRegistry(repoName));
    if (golden) {
      await withCreateLock(repoPath, () => scrapTree({ repoName, repoPath, emit, log }, golden));
      log.info({ repo: repoName }, "replenish: onDeck is 0; scrapped the golden");
    }
    return;
  }
```

Before the member `while` loop, ensure the golden (its own backoff key, so a broken golden never blocks members):
```ts
  const goldenKey = `${repoName}#golden`;
  if (!findGolden(loadRegistry(repoName)) && !createBlockedUntil(backoff, goldenKey)) {
    if (await hasFreeDiskGb(goldenRoot(repoName), WORKTREE_MIN_FREE_DISK_GB)) {
      const g = await withCreateLock(repoPath, () => createTree({ repoName, repoPath, emit, log, target: "golden" }));
      if (g.ok) backoff.delete(goldenKey);
      else if (g.error !== "busy") {
        const { failures, nextRetryAt } = noteCreateFailure(backoff, goldenKey);
        log.warn({ repo: repoName, error: g.error, failedStep: g.failedStep, failures, nextRetryAt }, "worktree reconciler: golden create failed");
      }
    }
  }
```
`hasFreeDiskGb(goldenRoot(repoName), ...)`: the golden root may not exist yet; `hasFreeDiskGb` already degrades to `true` on an unresolvable path (see its existing test), so this is safe.

Inside the member loop, replace the `createTree(...)` call in `withCreateLock` with a mode-aware build:
```ts
    const p: Promise<void> = withCreateLock(repoPath, async () => {
      const chosen = chooseCreateMode(loadRegistry(repoName), cfg.root, Date.now(), sameVolumeForPass);
      if (chosen.mode === "hydrate") {
        const h = await hydrateTree({ repoName, repoPath, emit, log, golden: chosen.golden, clone: deps.clone });
        if (h.ok || h.error === "busy") return h;
        if (h.error !== "hydrate-unavailable") return h;
        log.warn({ repo: repoName, detail: h.detail }, "replenish: hydration unavailable; cold create");
      } else {
        log.debug?.({ repo: repoName, why: chosen.why }, "replenish: cold create");
      }
      return createTree({ repoName, repoPath, emit, log });
    })
```
The `.then((result) => ...)` chain that follows stays as is: both `HydrateResult` and `CreateResult` carry `ok`, `error`, and (for failures) `failedStep`. Widen the parameter type to `CreateResult | HydrateResult` and read `failedStep` with `"failedStep" in result ? result.failedStep : undefined`.

- [ ] **Step 3b: Add the reconcile adopt test**

Append to `lib/daemon/__tests__/worktree-reconciler.test.ts` (or `lib/daemon/reconciler/__tests__/reconcile.test.ts`, wherever that suite's `reconcileRepoRegistry` tests live):

```ts
  test("a registered golden is not re-adopted as unmanaged", async () => {
    const golden: TreeRecord = { name: "golden", path: goldenRoot(repoName), kind: "golden", state: "on-deck", branch: "golden", createdAt: new Date().toISOString(), readyStamp: "abc" };
    saveRegistry(repoName, [golden]);
    await reconcileRepoRegistry({ repoName, repoPath: repo, emit: () => {}, log: fakeLog() });
    const rows = loadRegistry(repoName).filter((r) => r.path === golden.path);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("golden");
  });
```
Match the suite's real `reconcileRepoRegistry` call shape and helper names; the assertion is that step (b) leaves a known golden path alone.

- [ ] **Step 4: Run the replenish suite**

Run: `bun test lib/daemon/reconciler/__tests__/replenish.test.ts`
Expected: PASS, including the pre-existing tests (note: the existing backoff tests use `ready: [{ run: "exit 1" }]`, which now also fails the golden build; they assert on `backoff.get(repoName)`, which is the member key, so they still hold).

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/reconciler/replenish.ts lib/daemon/reconciler/__tests__/replenish.test.ts
git commit -m "reconciler: ensure the golden and hydrate members from it"
```

---

### Task 8: Freshen visits the golden, and first

**Files:**
- Modify: `lib/daemon/reconciler/freshen.ts:65-68` (`freshenCandidate`), `:250-254` (`freshenRepo` iteration)
- Test: `lib/daemon/reconciler/__tests__/freshen.test.ts` (append)

**Interfaces:**
- Consumes: `TreeKind "golden"` (Task 2).
- Produces: `freshenCandidate` returns `rec.state === "on-deck"` for `kind === "golden"`; `freshenRepo` orders the golden row first.

- [ ] **Step 1: Write the failing test**

Append inside `describe("freshen.ts: freshenRepo", ...)`:

```ts
  test("golden is a candidate and is freshened before members", async () => {
    // A `changed:` step whose glob the bump touches: freshenOne only advances
    // readyStamp when at least one step actually ran (toRun.length > 0), so an
    // empty ladder would leave every stamp untouched and prove nothing.
    await declareWorktrees(repo, repoName, {
      onDeck: 1,
      root: join(repo, ".worktrees"),
      ready: [{ run: "touch .freshened", when: "changed:tracked.txt" }],
    });
    const g = await createTree({ repoName, repoPath: repo, emit: () => {}, log: fakeLog() as never, target: "golden" });
    const m = await createTree({ repoName, repoPath: repo, emit: () => {}, log: fakeLog() as never });
    if (!g.ok || !m.ok) throw new Error("setup");
    writeFileSync(join(repo, "tracked.txt"), "bump\n");
    execSync("git add tracked.txt && git -c user.email=t@t -c user.name=t commit -qm bump && git push -q origin HEAD", { cwd: repo, shell: "/bin/zsh" });
    const newSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();

    const ran = await freshenRepo({ repoName, repoPath: repo, emit: () => {}, log: fakeLog() });

    expect(ran[0]).toBe("golden");
    expect(ran).toContain(m.tree.name);
    const after = loadRegistry(repoName);
    expect(after.find((t) => t.kind === "golden")?.readyStamp).toBe(newSha);
    expect(after.find((t) => t.name === m.tree.name)?.readyStamp).toBe(newSha);
    expect(existsSync(join(g.tree.path, ".freshened"))).toBe(true);
  });
```
Import `createTree` from `../../../worktree/create.ts`, plus `loadRegistry`, `writeFileSync` and `existsSync` if missing; reuse this file's `declareWorktrees`/`makeRepo` helpers (copy from `replenish.test.ts` if the file lacks them). A team-authored `ready` ladder is gated behind `ready-approve`, so declare it in the machine store the way `declareWorktrees` already does (that is the user/machine rung, which `evaluateReadyGate` does not hold).

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/reconciler/__tests__/freshen.test.ts -t "golden is a candidate"`
Expected: FAIL (`ran` does not contain `golden`).

- [ ] **Step 3: Implement**

`freshenCandidate`:
```ts
  if (rec.kind === "ephemeral" || rec.kind === "golden") return rec.state === "on-deck";
  if (rec.kind !== "main") return false;
```

`freshenRepo`, replace `const trees = loadRegistry(repoName);` with:
```ts
  // The golden is the hydration donor, so it takes a master bump before any member does.
  const trees = loadRegistry(repoName).sort((a, b) => Number(b.kind === "golden") - Number(a.kind === "golden"));
```
(`Array.prototype.sort` is stable; only the golden moves.)

Check the one place in `freshenOne` that branches on `rec.kind === "main"` (line ~124) and confirm the ephemeral path is the `else`; the golden must take the ephemeral path (ff-only to origin default, then `changed:` steps). If the code narrows on `kind === "ephemeral"` anywhere in the freshen body, widen it to `kind === "ephemeral" || kind === "golden"`.

- [ ] **Step 4: Run the freshen suite**

Run: `bun test lib/daemon/reconciler/__tests__/freshen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/reconciler/freshen.ts lib/daemon/reconciler/__tests__/freshen.test.ts
git commit -m "reconciler: freshen the golden first"
```

---

### Task 8b: `worktree:adopt` leaves the golden alone

**Files:**
- Modify: `lib/daemon/handlers/worktree.ts:799-846` (the adopt loop)
- Test: `lib/daemon/__tests__/worktree-handlers.test.ts` (append)

**Interfaces:**
- Consumes: `TreeKind "golden"` (Task 2).
- Produces: the adopt loop skips `kind === "golden"` rows exactly as it skips `ephemeral` ones; a golden is never reported in `claimed`, `unmanaged`, or `disposed`.

- [ ] **Step 1: Write the failing test**

```ts
describe("worktree:adopt and the golden", () => {
  test("adopt --claim leaves a golden row untouched and does not report it", async () => {
    // Build the handler map the way the suite's other adopt tests do, with a
    // registry holding one golden row and one unmanaged row.
    saveRegistry(repoName, [
      { name: "golden", path: goldenPath, kind: "golden", state: "on-deck", branch: "golden", createdAt: new Date().toISOString(), readyStamp: "abc" },
      { name: "stray", path: strayPath, kind: "unmanaged", branch: "some-branch", createdAt: new Date().toISOString() },
    ]);

    const res = await handlers["worktree:adopt"]({ repoName, claim: true });

    expect(res.ok).toBe(true);
    expect(res.data.claimed).toEqual(["stray"]);
    expect(res.data.claimed).not.toContain("golden");
    expect(res.data.unmanaged).not.toContain("golden");
    expect(res.data.disposed).not.toContain("golden");

    const after = loadRegistry(repoName).find((r) => r.path === goldenPath)!;
    expect(after.kind).toBe("golden");
    expect(after.state).toBe("on-deck");
    expect(after.claimedAt).toBeUndefined();
  });
});
```
Mirror the suite's existing adopt test for how it builds `handlers`, `repoName`, and the on-disk worktrees; the two assertions that matter are the golden's kind/state surviving and it being absent from every result array.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/__tests__/worktree-handlers.test.ts -t "adopt --claim leaves a golden"`
Expected: FAIL. Today the golden falls past the `main` and `ephemeral` skips into the `payload?.claim === true` branch and is rewritten to `kind: "ephemeral", state: "claimed"`, which also makes it eligible for merge-reactor disposal.

- [ ] **Step 3: Implement**

In the adopt loop in `lib/daemon/handlers/worktree.ts`, widen the managed-kind skip:

```ts
          // Trees rt already manages are left exactly as they are. The golden
          // is rt's hydration donor: adopting it would hand the pool's source
          // to a caller and then let the merge reactor dispose it.
          if (rec.kind === "ephemeral" || rec.kind === "golden") continue;
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/daemon/__tests__/worktree-handlers.test.ts`
Expected: PASS, including the pre-existing adopt tests.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/worktree.ts lib/daemon/__tests__/worktree-handlers.test.ts
git commit -m "worktree: adopt skips the golden"
```

---

### Task 9: CLI shows the golden honestly; guards refuse it

**Files:**
- Modify: `commands/worktree.ts:314`, `:621`, `:728`
- Test: `commands/__tests__/worktree.test.ts` (append)
- Test: `lib/daemon/__tests__/worktree-handlers.test.ts` (append)

**Interfaces:**
- Consumes: `TreeKind "golden"`; `isClaimable` (`lib/daemon/handlers/worktree.ts:244`); dispose guard 1 (`lib/worktree/dispose.ts:225`).
- Produces: `rt worktree list` prints `golden` for the golden row where it prints `state ?? kind` today; `rt worktree freshen`'s TTY picker includes the golden. No new guard code: the tests pin the existing guards' behavior for the new kind.

- [ ] **Step 1: Write the failing CLI test**

Append inside the existing `describe` in `commands/__tests__/worktree.test.ts`, using its `installFakeDaemon`:

```ts
  test("list labels the golden row by kind, not its on-deck state", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        trees: [
          { name: "golden", path: "/nonexistent/golden", kind: "golden", state: "on-deck", branch: null, repoName: "github.com/acme/app", createdAt: "2026-09-21T00:00:00.000Z" },
        ],
      },
    });
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
    try {
      await worktreeList([], {});
    } finally {
      console.log = origLog;
    }
    const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    const row = plain.find((l) => l.includes("/golden "));
    expect(row).toBeDefined();
    expect(row).toMatch(/\/golden\s+golden\s+\(detached\)/);
    expect(row).not.toContain("on-deck");
  });
```
`branch: null` keeps `enrichTrailingByPath` from consulting the repo index for a repo the test HOME does not know.

- [ ] **Step 2: Write the failing guard tests**

Append to `lib/daemon/__tests__/worktree-handlers.test.ts` (import `isClaimable` from `../handlers/worktree.ts`, `disposeTree` from `../../worktree/dispose.ts`, `saveRegistry` and `TreeRecord` from `../../worktree/registry.ts`; reuse the file's HOME/`closeStateDb` setup):

```ts
describe("golden guards", () => {
  const golden: TreeRecord = { name: "golden", path: "/g", kind: "golden", state: "on-deck", branch: "golden", createdAt: "2026-09-21T00:00:00.000Z", readyStamp: "abc" };

  test("a ready golden is never claimable", () => {
    expect(isClaimable(golden)).toBe(false);
  });

  test("dispose refuses the golden with kind-golden even when forced", async () => {
    // dispose re-reads the registry under the lock and refuses "changed" if the
    // row is absent, so the row has to be there or guard 1 never runs.
    saveRegistry("acme", [golden]);
    const outcome = await disposeTree(
      { repoName: "acme", repoPath: "/repo", cacheEntries: {}, emit: () => {}, log: { info: () => {}, warn: () => {}, debug: () => {} } as never, killProcesses: false, findRunningRun: () => ({ kind: "none" }) },
      golden,
      { auto: false, force: true },
    );
    expect(outcome.disposed).toBe(false);
    if (outcome.disposed) return;
    expect(outcome.refusal).toBe("kind-golden");
  });
});
```
The outcome shape is `{ disposed: false; refusal: string; detail?: string }` (`lib/worktree/dispose.ts:137-142`), and guard 1 is `refuse(\`kind-${rec.kind}\`)` at `:225`, so `kind-golden` needs no new code. Read `disposeTree`'s option bag as `replenish.ts:224` passes it and match the real spellings.

- [ ] **Step 3: Run to verify failure**

Run: `bun test commands/__tests__/worktree.test.ts -t "golden row" && bun test lib/daemon/__tests__/worktree-handlers.test.ts -t "golden guards"`
Expected: the CLI test FAILS (`golden  on-deck` printed); the guard tests PASS already (they pin existing behavior). Both outcomes are expected.

- [ ] **Step 4: Implement the CLI change**

At both display sites (`:314` and `:621`) replace `r.state ?? r.kind` with a helper defined once near the top of `commands/worktree.ts`:
```ts
/** The golden's state is readiness bookkeeping; its kind is what a human needs to see. */
function rowLabel(r: { kind: string; state?: string }): string {
  return r.kind === "golden" ? "golden" : (r.state ?? r.kind);
}
```
At `:728`, widen the freshen candidate filter:
```ts
      .filter((r) => ((r.kind === "ephemeral" || r.kind === "golden") && r.state === "on-deck") || r.kind === "main")
```

- [ ] **Step 4b: Test the freshen picker filter**

Append to `commands/__tests__/worktree.test.ts`, using the file's `installFakePick` pattern (see its existing await-ready breadcrumb test for the TTY setup):

```ts
  test("freshen's picker offers the golden alongside on-deck members", async () => {
    const { installFakePick } = await import("../../lib/ui/pick-fake.ts");
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    installFakeDaemon({
      ok: true,
      data: {
        trees: [
          { name: "golden", path: "/g", kind: "golden", state: "on-deck", branch: null, repoName: "r1", createdAt: "2026-09-21T00:00:00.000Z" },
          { name: "lupin", path: "/l", kind: "ephemeral", state: "on-deck", branch: null, repoName: "r1", createdAt: "2026-09-21T00:00:00.000Z" },
          { name: "hedwig", path: "/h", kind: "ephemeral", state: "claimed", branch: null, repoName: "r1", createdAt: "2026-09-21T00:00:00.000Z" },
        ],
      },
    });
    const fake = installFakePick([{ kind: "result", result: { action: "cancel", value: null, query: "" } }]);
    try {
      await worktreeFreshen([], {});
    } finally {
      fake.restore();
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
    expect(fake.calls).toHaveLength(1);
    const values = fake.calls[0]!.request.rows.map((r) => r.value);
    expect(values).toContain("/g");
    expect(values).toContain("/l");
    expect(values).not.toContain("/h");
  });
```
`installFakePick` takes a `PickFakeStep[]` script and returns `{ calls, restore }`; the rows it was handed are on `calls[0].request.rows`, and `pickOneTree` sets each row's `value` to the tree path. The working pattern is the await-ready breadcrumb test at `commands/__tests__/worktree.test.ts:196`. `action: "cancel"` is what `filterableSelect` turns into a null pick (`lib/pick-wrappers.ts:97`), so the picker closes without selecting and the assertion lands on what reached it. Import `worktreeFreshen` from `../worktree.ts`.

- [ ] **Step 5: Run both suites**

Run: `bun test commands/__tests__/worktree.test.ts lib/daemon/__tests__/worktree-handlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/worktree.ts commands/__tests__/worktree.test.ts lib/daemon/__tests__/worktree-handlers.test.ts
git commit -m "worktree cli: label the golden by kind; pin the guards for the new kind"
```

---

### Task 10: Full verification and CLAUDE.md pointer

**Files:**
- Modify: `CLAUDE.md` (new short section after "## Repo identity")

- [ ] **Step 1: Add the pointer**

```markdown
## Worktree pool: the golden tree

Every repo with `onDeck > 0` has one `kind: "golden"` worktree under
`~/.mattstack/rt/golden/<segment>/`. New on-deck members are built by
`clonefile(2)`-ing its git-ignored artifacts and inheriting its
`readyStamp`; they never run `pnpm install` at birth. Before touching
`lib/worktree/hydrate.ts`, `lib/worktree/clonefile.ts`, or replenish, read
`docs/superpowers/specs/2026-09-21-golden-worktree-hydration-design.md`. Two
traps: the golden and the pool root must share an APFS volume (`EXDEV`
otherwise, and replenish silently cold-creates), and `pnpm install` on an
already-up-to-date tree still reruns every lifecycle script (~3 min), so a
hydrated tree must inherit the stamp rather than "verify" with an install.
```

- [ ] **Step 2: Run the full gates**

Run:
```bash
bunx tsc --noEmit
bun run test
bun run test:e2e
bun run picker:check
```
Expected: all green. If `bun run test` shows a rotating flake unrelated to this branch, rerun the single failing file in isolation and record its name in the PR body; do not treat it as a pass without the rerun.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: golden worktree pointer in CLAUDE.md"
```

---

## Appendix A: Go helper fallback (only if Task 1 is a no-go)

The daemon-side contract from Task 4 does not change. `commands/worktree.ts`'s `worktreeHydrateClone` becomes a thin exec of a helper binary instead of calling `bun:ffi`:

```ts
export async function worktreeHydrateClone(args: string[], _ctx: unknown): Promise<void> {
  const [src, dst] = args.filter((a) => !a.startsWith("--"));
  if (!src || !dst || src === dst) {
    console.error("usage: rt worktree hydrate-clone <src> <dst>");
    process.exit(2);
  }
  const bin = resolveHelperBinary("rt-clone"); // same resolution rules as rt-ui: source checkout's helpers/dist first, then Contents/Helpers
  const r = await runCapture([bin, src, dst], { stderr: "pipe" });
  if (r.stderr) console.error(r.stderr.trim());
  process.exit(r.exitCode);
}
```

Helper source, `helpers/rt-clone/main.go`:
```go
package main

import (
	"errors"
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func main() {
	if len(os.Args) != 3 || os.Args[1] == os.Args[2] {
		fmt.Fprintln(os.Stderr, "usage: rt-clone <src> <dst>")
		os.Exit(2)
	}
	if err := unix.Clonefile(os.Args[1], os.Args[2], 0); err != nil {
		fmt.Fprintf(os.Stderr, "clonefile: %v\n", err)
		var errno syscall.Errno
		if errors.As(err, &errno) {
			switch errno {
			case unix.EXDEV:
				os.Exit(3)
			case unix.ENOTSUP:
				os.Exit(4)
			case unix.EEXIST:
				os.Exit(5)
			}
		}
		os.Exit(1)
	}
}
```
Build and bundle wiring mirrors `rt-ui`: a `helpers:build` script producing `helpers/dist/rt-clone`, copied to `Contents/Helpers/rt-clone` and signed with `scripts/entitlements.plist` in `bundle-apps.yml` exactly where `rt-ui` is. `lib/worktree/clonefile.ts` and its unit test are dropped; Task 4's tests are unchanged.
