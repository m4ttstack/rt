# Worktree Triage Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tray **Worktrees…** panel, backed by a daemon `worktree:triage` verb, that lists every tree the reactor left behind with why it's stuck, whether its work is safe elsewhere, and one guarded action per tree, plus a menu count and a once-a-day summary notification.

**Architecture:** The daemon computes every verdict: a pure verdict function over facts gathered by an IO collector, exposed as `worktree:triage` and five guarded action verbs in a new handler module. The tray (Swift) only decodes and renders; its pure models live in `MattstackCore` so they are testable. A daily `scheduleSweep` posts the summary through the existing `notifyEnabled` path, and a new notification category routes the click to the panel.

**Tech Stack:** Bun + TypeScript (daemon, `bun:test`), Swift 5 / SwiftUI + AppKit (tray, `mattstack-checks` harness), git.

**Spec:** `docs/superpowers/specs/2026-09-24-worktree-triage-panel-design.md`. Boards: `docs/design/worktrees/*.png`. Read both before starting any task.

## Global Constraints

- No em dashes or en dashes anywhere (code, comments, copy, commits). Use "...", parens, or rephrase.
- Comments only state constraints the code can't show; no narration, no ticket ids, no decision history.
- Every per-repo key uses the serialized repo identity (see `docs/repo-identity.md`); settings sections key on the raw `host/path` form.
- New daemon verbs are registered in `packages/rt-client/src/commands.ts` (`Commands` + `COMMAND_NAMES`); `lib/daemon/__tests__/rt-client-commands.test.ts` must stay green. Run `bun run build` in `packages/rt-client` after touching it.
- Only `worktree:triage` is agent-safe. No action verb is.
- Nothing is ever deleted except through `disposeTree` (the 14-day trash). The only forced dispose is **Dispose anyway** on an `only-copy` row with `confirmOnlyCopy: true`.
- Junk default: `[".visual/**", ".build/**", "**/node_modules/**", "**/.turbo/**", "**/build/**", "**/dist/**"]`.
- Summary: at most one notification per local day, at the first sweep tick at or after 09:00, only when `needsDecision > 0`; category `worktree_triage`.
- Colour budget per row: verdict icon + MR chip only (merged blue, closed red, open green); the `unpushed` chip's icon is red; everything else neutral; kept rows fully neutral.
- Tests that touch the filesystem run under an isolated `HOME` (`process.env.HOME = mkdtemp`, then `closeStateDb()`), as the existing reactor tests do. Never run a built binary or daemon against the real `~/.mattstack`.
- Swift pure logic goes in `rt-tray/Sources-core` (target `MattstackCore`); checks run with `cd rt-tray && swift build && swift run mattstack-checks <filter>`.
- Run `bun run test:all` (not just `bun run test`) before the final task's commit.

## Review Focus

1. **A tree that changed between render and click** (new commit, new dirty file, MR reopened): the action must refuse with `changed`, never act on the stale verdict. Pinned in Task 6.
2. **A path with spaces or a git-quoted name in the dirt list** (`"my file.txt"`): classification must see the real path, and `discard: "classified"` must remove exactly that path. Pinned in Task 2.
3. **A `bun.lock` diff that changes a dependency version, not just a workspace `"version"`**: must classify as `real`, not `lockfile`. Pinned in Task 2.
4. **The MR head sha isn't available locally and the fetch fails** (offline, deleted fork): patch-identical containment must fail closed (`none`), never `patch-identical`. Pinned in Task 1.
5. **The summary sweep across a daemon restart after 09:00 the same day**: must not send twice. Pinned in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/worktree/containment.ts` (new) | `patchIdenticalToMr`, `containmentOf`: is a tree's work safe elsewhere |
| `lib/worktree/dispose.ts` (modify) | containment guard accepts patch-identical commits |
| `lib/worktree/dirt-class.ts` (new) | classify dirt as none/junk/lockfile/real; list classified paths |
| `lib/worktree/config.ts` (modify) | `junk` field on `WorktreeRepoConfig` |
| `packages/rt-client/src/settings/registry-defs.ts` (modify) | document `junk` on `rt.worktrees` |
| `lib/worktree/registry.ts` (modify) | `kept` record on `TreeRecord` |
| `lib/worktree/triage/fingerprint.ts` (new) | fingerprint + keep-snapshot helpers |
| `lib/worktree/triage/verdict.ts` (new) | pure: facts to group, verdict, actions, counts |
| `lib/worktree/triage/facts.ts` (new) | IO: gather facts for one tree / all repos |
| `lib/daemon/handlers/worktree-triage.ts` (new) | `worktree:triage`, `triage-dispose`, `keep`, `unkeep`, `push-branch`, `triage-diff` |
| `lib/daemon/command-router.ts` (modify) | spread the triage handlers |
| `packages/rt-client/src/commands.ts` (modify) | payload/data types, `COMMAND_NAMES` |
| `lib/daemon/triage-summary.ts` (new) | daily summary sweep |
| `lib/notifier.ts`, `lib/daemon.ts` (modify) | `worktree_triage` notification type; wire the sweep |
| `commands/worktree.ts`, `lib/command-tree-def.ts` (modify) | `rt worktree triage` |
| `rt-tray/Sources-core/Worktree/Triage.swift` (new) | Codable models, section grouping, badge count |
| `rt-tray/Sources-core/Launch/NotificationClick.swift` (modify) | `worktree_triage` category, `.showWorktreePanel` route |
| `rt-tray/Tests/MattstackCoreChecks/TriageChecks.swift` (new) | checks for the above |
| `rt-tray/Sources/DaemonClient.swift` (modify) | POST payload support, triage calls |
| `rt-tray/Sources/WorktreePanelController.swift` (new) | polling, actions, footer status |
| `rt-tray/Sources/WorktreePanelView.swift` (new) | panel, rows, chips, sections |
| `rt-tray/Sources/WorktreeReviewSheet.swift` (new) | Review sheet |
| `rt-tray/Sources/AppDelegate.swift`, `NotificationManager.swift`, `AccessibilityIDs.swift` (modify) | menu item + count, window, click routing |

---

### Task 1: Patch-identical containment (RT-271)

**Files:**
- Create: `lib/worktree/containment.ts`
- Modify: `lib/worktree/dispose.ts` (the containment block inside `disposeTree`, currently `if (!mr || !(await mergedMrCoversHead(rec, mr))) { ... }`)
- Test: `lib/worktree/__tests__/containment.test.ts`, and extend the dispose tests in `lib/daemon/reconciler/__tests__/reactor.test.ts`

**Interfaces:**
- Produces:
  - `export type Containment = "in-default" | "on-remote" | "patch-identical" | "none";`
  - `export async function patchIdenticalToMr(treePath: string, mrSha: string, defaultRef: string, fetch?: (sha: string) => Promise<boolean>): Promise<boolean>`
  - `export async function containmentOf(treePath: string, branch: string | null, mr: { state?: string | null; sha?: string | null } | null, fetch?: (sha: string) => Promise<boolean>): Promise<Containment>`

- [ ] **Step 1: Write the failing tests**

`lib/worktree/__tests__/containment.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { containmentOf, patchIdenticalToMr } from "../containment.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const sh = (cmd: string, cwd?: string) => execSync(cmd, { cwd, shell: "/bin/zsh", stdio: "pipe" }).toString().trim();

function repoWithOrigin(): { repo: string } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "rtcontain-")));
  sh(`git init -q -b main ${repo}`);
  sh(`git ${GIT_ID} commit -q --allow-empty -m init`, repo);
  const bare = mkdtempSync(join(tmpdir(), "rtcontain-bare-"));
  sh(`git clone -q --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch -q origin`);
  return { repo };
}

function commit(cwd: string, file: string, body: string): string {
  writeFileSync(join(cwd, file), body);
  sh(`git add -A && git ${GIT_ID} commit -q -m ${file}`, cwd);
  return sh("git rev-parse HEAD", cwd);
}

describe("containmentOf", () => {
  let repo: string;
  beforeEach(() => ({ repo } = repoWithOrigin()));

  test("a branch whose HEAD is in the default branch is in-default", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    sh("git push -q origin feat:main", repo);
    sh("git fetch -q origin", repo);
    expect(await containmentOf(repo, "feat", null)).toBe("in-default");
  });

  test("a pushed branch not in main is on-remote", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    sh("git push -q origin feat", repo);
    expect(await containmentOf(repo, "feat", null)).toBe("on-remote");
  });

  test("a branch rebased before merge is patch-identical to the merged MR", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    commit(repo, "b.txt", "b\n");
    const local = sh("git rev-parse HEAD", repo);
    // What the forge saw: the same two patches rebased onto a moved main.
    sh("git checkout -q main", repo);
    commit(repo, "other.txt", "o\n");
    sh("git checkout -q -b rebased", repo);
    sh(`git ${GIT_ID} cherry-pick -q feat~1 feat`, repo);
    const mrSha = sh("git rev-parse HEAD", repo);
    sh("git push -q origin main", repo);
    sh("git checkout -q feat", repo);
    expect(sh("git rev-parse HEAD", repo)).toBe(local);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("patch-identical");
  });

  test("one extra local commit beyond the merged MR is none", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const mrSha = sh("git rev-parse HEAD", repo);
    commit(repo, "extra.txt", "x\n");
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("none");
  });

  test("an MR sha that is not local and cannot be fetched fails closed", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const missing = "0123456789abcdef0123456789abcdef01234567";
    expect(await patchIdenticalToMr(repo, missing, "origin/main", async () => false)).toBe(false);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: missing }, async () => false)).toBe("none");
  });
});
```

In `lib/daemon/reconciler/__tests__/reactor.test.ts`, add to the `held trees say why (RT-267)` describe (it already has `detect`, `find`, `headOf`, `ephemeralTree`):

```ts
  test("a merged tree rebased before merge disposes instead of refusing as unpushed", async () => {
    const rec = ephemeralTree(repo, repoName, "xray", "feat-xray");
    const local = headOf(rec.path);
    execSync(`git -C ${repo} checkout -q -b forge-xray origin/main`, { shell: "/bin/zsh" });
    execSync(`git -C ${repo} -c user.email=t@t -c user.name=t cherry-pick -q ${local}`, { shell: "/bin/zsh" });
    const mrSha = execSync(`git -C ${repo} rev-parse HEAD`, { encoding: "utf8" }).trim();
    execSync(`git -C ${repo} checkout -q main`, { shell: "/bin/zsh" });
    execSync(`git -C ${rec.path} push -q -f origin :feat-xray`, { shell: "/bin/zsh" });
    await detect({ "feat-xray": { repoName, mr: { iid: 92, state: "merged", sha: mrSha } } });
    expect(find(rec.path)).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/worktree/__tests__/containment.test.ts lib/daemon/reconciler/__tests__/reactor.test.ts`
Expected: containment tests fail with `Cannot find module '../containment.ts'`; the reactor test fails because the tree is marked `disposable` (`unpushed`).

- [ ] **Step 3: Implement `lib/worktree/containment.ts`**

```ts
import { isAncestorAsync, remoteDefaultRef, remoteRefExists, runGit } from "./git-async.ts";

export type Containment = "in-default" | "on-remote" | "patch-identical" | "none";

const FETCH_TIMEOUT_MS = 60_000;

async function fetchSha(treePath: string, sha: string): Promise<boolean> {
  const r = await runGit(treePath, ["fetch", "--no-tags", "-q", "origin", sha], { timeoutMs: FETCH_TIMEOUT_MS });
  return r.exitCode === 0;
}

async function hasObject(treePath: string, sha: string): Promise<boolean> {
  return (await runGit(treePath, ["cat-file", "-e", `${sha}^{commit}`])).exitCode === 0;
}

/** Stable patch-ids of `range`, one per commit. */
async function patchIds(treePath: string, range: string): Promise<Set<string> | null> {
  const log = await runGit(treePath, ["log", "-p", "--no-merges", "--format=commit %H", range]);
  if (log.exitCode !== 0) return null;
  const proc = Bun.spawn(["git", "patch-id", "--stable"], { cwd: treePath, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  proc.stdin.write(log.stdout);
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return null;
  return new Set(out.split("\n").filter(Boolean).map((l) => l.split(" ")[0]!));
}

/**
 * Every commit on HEAD that the default branch lacks has a patch-identical
 * twin between the merge-base and the MR head. Squash merges never match
 * (their one commit is a new patch); they still pass through the MR-sha
 * ancestry check in dispose. Missing objects fail closed.
 */
export async function patchIdenticalToMr(
  treePath: string,
  mrSha: string,
  defaultRef: string,
  fetch: (sha: string) => Promise<boolean> = (sha) => fetchSha(treePath, sha),
): Promise<boolean> {
  if (!(await hasObject(treePath, mrSha)) && !((await fetch(mrSha)) && (await hasObject(treePath, mrSha)))) return false;
  const base = await runGit(treePath, ["merge-base", defaultRef, mrSha]);
  if (base.exitCode !== 0) return false;
  const local = await patchIds(treePath, `${defaultRef}..HEAD`);
  const merged = await patchIds(treePath, `${base.stdout.trim()}..${mrSha}`);
  if (!local || !merged || local.size === 0) return false;
  for (const id of local) if (!merged.has(id)) return false;
  return true;
}

export async function containmentOf(
  treePath: string,
  branch: string | null,
  mr: { state?: string | null; sha?: string | null } | null,
  fetch?: (sha: string) => Promise<boolean>,
): Promise<Containment> {
  const defaultRef = await remoteDefaultRef(treePath);
  if (await isAncestorAsync(treePath, "HEAD", defaultRef)) return "in-default";
  if (branch && (await remoteRefExists(treePath, branch)) && (await isAncestorAsync(treePath, "HEAD", `refs/remotes/origin/${branch}`))) {
    return "on-remote";
  }
  if (mr?.state === "merged" && mr.sha && (await patchIdenticalToMr(treePath, mr.sha, defaultRef, fetch))) return "patch-identical";
  return "none";
}
```

Check `runGit`'s signature in `lib/worktree/git-async.ts:53` and match its option name for the timeout (`timeoutMs`, as `reactor.ts` passes `{ timeoutMs: MUTATING_TIMEOUT_MS }`).

- [ ] **Step 4: Teach dispose's containment guard the patch-identical case**

In `lib/worktree/dispose.ts`, replace:

```ts
    const mr = joinedMr(deps, rec);
    if (!mr || !(await mergedMrCoversHead(rec, mr))) {
      const anchorRefusal = await remoteAnchorRefusal(rec);
      if (anchorRefusal) return refuse(anchorRefusal);
    }
```

with:

```ts
    const mr = joinedMr(deps, rec);
    if (!mr || !(await mergedMrCoversHead(rec, mr))) {
      const anchorRefusal = await remoteAnchorRefusal(rec);
      const rebasedIntoMr = anchorRefusal !== null && mr?.state === "merged" && mr.sha
        ? await patchIdenticalToMr(rec.path, mr.sha, await remoteDefaultRef(rec.path))
        : false;
      if (anchorRefusal && !rebasedIntoMr) return refuse(anchorRefusal);
    }
```

and add `import { patchIdenticalToMr } from "./containment.ts";` (`remoteDefaultRef` is already imported there).

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/worktree/__tests__/containment.test.ts lib/daemon/reconciler lib/daemon/__tests__/worktree-handlers.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/worktree/containment.ts lib/worktree/dispose.ts lib/worktree/__tests__/containment.test.ts lib/daemon/reconciler/__tests__/reactor.test.ts
git commit -m "dispose: accept a branch rebased into its merged MR (RT-271)"
```

---

### Task 2: Junk setting and dirt classifier

**Files:**
- Create: `lib/worktree/dirt-class.ts`
- Modify: `lib/worktree/config.ts` (`WorktreeRepoConfig` at :94, sanitizers near `sanitizeNamePool` :193, `loadWorktreeRepoConfig` :203-222), `packages/rt-client/src/settings/registry-defs.ts:37-46` (description text)
- Test: `lib/worktree/__tests__/dirt-class.test.ts`, extend `lib/worktree/__tests__/config*.test.ts` (whichever file tests `staleClaimDays`; find with `grep -rln staleClaimDays lib/**/__tests__`)

**Interfaces:**
- Produces:
  - `export const DEFAULT_JUNK_GLOBS: string[]` (in `config.ts`)
  - `WorktreeRepoConfig.junk: string[]`
  - `export type DirtKind = "none" | "junk" | "lockfile" | "real";`
  - `export interface DirtClass { kind: DirtKind; files: string[]; discardable: string[] }` where `files` is every dirty path (for display) and `discardable` is the exact set `discard: "classified"` may remove (empty unless kind is `junk` or `lockfile`)
  - `export async function classifyDirtForTriage(treePath: string, junkGlobs: string[]): Promise<DirtClass>`
  - `export function isVersionOnlyLockDiff(unifiedDiff: string): boolean`

- [ ] **Step 1: Write the failing tests**

`lib/worktree/__tests__/dirt-class.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { classifyDirtForTriage, isVersionOnlyLockDiff } from "../dirt-class.ts";
import { DEFAULT_JUNK_GLOBS } from "../config.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const sh = (cmd: string, cwd: string) => execSync(cmd, { cwd, shell: "/bin/zsh", stdio: "pipe" }).toString();

const LOCK = `{
  "workspaces": {
    "packages/rt-client": {
      "name": "@mattstack/rt-client",
      "version": "0.28.0",
      "dependencies": {
        "jsonc-parser": "^3.3.1",
      },
    },
  },
}
`;

describe("classifyDirtForTriage", () => {
  let tree: string;
  beforeEach(() => {
    tree = realpathSync(mkdtempSync(join(tmpdir(), "rtdirt-")));
    sh("git init -q -b main .", tree);
    writeFileSync(join(tree, "bun.lock"), LOCK);
    writeFileSync(join(tree, "src.ts"), "export {}\n");
    sh(`git add -A && git ${GIT_ID} commit -q -m init`, tree);
  });

  test("a clean tree is none", async () => {
    expect((await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS)).kind).toBe("none");
  });

  test("an untracked screenshot folder is junk and discardable", async () => {
    mkdirSync(join(tree, ".visual"));
    writeFileSync(join(tree, ".visual", "a.png"), "x");
    const d = await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS);
    expect(d.kind).toBe("junk");
    expect(d.discardable).toEqual([".visual/a.png"]);
  });

  test("build output for a package the branch doesn't have is junk", async () => {
    for (const p of ["packages/tenant/node_modules/x/index.js", "packages/tenant/.turbo/turbo-build.log", "packages/tenant/build/index.js"]) {
      mkdirSync(join(tree, p, ".."), { recursive: true });
      writeFileSync(join(tree, p), "x");
    }
    expect((await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS)).kind).toBe("junk");
  });

  test("an untracked folder with one source file among the build output is real", async () => {
    mkdirSync(join(tree, "packages/tenant/build"), { recursive: true });
    writeFileSync(join(tree, "packages/tenant/build/index.js"), "x");
    writeFileSync(join(tree, "packages/tenant/index.ts"), "x");
    const d = await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS);
    expect(d.kind).toBe("real");
    expect(d.discardable).toEqual([]);
  });

  test("a bun.lock whose only change is a workspace version line is lockfile", async () => {
    writeFileSync(join(tree, "bun.lock"), LOCK.replace('"version": "0.28.0"', '"version": "0.29.0"'));
    const d = await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS);
    expect(d.kind).toBe("lockfile");
    expect(d.discardable).toEqual(["bun.lock"]);
  });

  test("a bun.lock that changes a dependency range is real", async () => {
    writeFileSync(join(tree, "bun.lock"), LOCK.replace("^3.3.1", "^3.4.0"));
    expect((await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS)).kind).toBe("real");
  });

  test("a lockfile change plus junk is still discardable, as lockfile", async () => {
    writeFileSync(join(tree, "bun.lock"), LOCK.replace('"version": "0.28.0"', '"version": "0.29.0"'));
    mkdirSync(join(tree, ".visual"));
    writeFileSync(join(tree, ".visual", "a.png"), "x");
    const d = await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS);
    expect(d.kind).toBe("lockfile");
    expect(d.discardable.sort()).toEqual([".visual/a.png", "bun.lock"]);
  });

  test("a modified source file is real", async () => {
    writeFileSync(join(tree, "src.ts"), "export const a = 1\n");
    expect((await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS)).kind).toBe("real");
  });

  test("a junk file whose name has spaces is reported by its real path", async () => {
    mkdirSync(join(tree, ".visual"));
    writeFileSync(join(tree, ".visual", "my shot.png"), "x");
    const d = await classifyDirtForTriage(tree, DEFAULT_JUNK_GLOBS);
    expect(d.kind).toBe("junk");
    expect(d.discardable).toEqual([".visual/my shot.png"]);
  });
});

describe("isVersionOnlyLockDiff", () => {
  test("accepts only +/- version lines", () => {
    expect(isVersionOnlyLockDiff('@@ -5 +5 @@\n-      "version": "0.28.0",\n+      "version": "0.29.0",\n')).toBe(true);
    expect(isVersionOnlyLockDiff('@@ -8 +8 @@\n-        "jsonc-parser": "^3.3.1",\n+        "jsonc-parser": "^3.4.0",\n')).toBe(false);
    expect(isVersionOnlyLockDiff("")).toBe(false);
  });
});
```

In the config test file, add:

```ts
  test("junk defaults to the build-output globs and accepts a declared list", async () => {
    // Use the file's existing helper for declaring rt.worktrees on a repo; the
    // default case needs no declaration.
    expect((await loadWorktreeRepoConfig(repoName, repoPath)).junk).toEqual(DEFAULT_JUNK_GLOBS);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/worktree/__tests__/dirt-class.test.ts`
Expected: FAIL, `Cannot find module '../dirt-class.ts'`.

- [ ] **Step 3: Add the `junk` field to `lib/worktree/config.ts`**

```ts
export const DEFAULT_JUNK_GLOBS = [".visual/**", ".build/**", "**/node_modules/**", "**/.turbo/**", "**/build/**", "**/dist/**"];

function sanitizeJunk(raw: unknown): string[] {
  if (!Array.isArray(raw)) return DEFAULT_JUNK_GLOBS;
  const globs = raw.filter((g): g is string => typeof g === "string" && g.trim().length > 0 && !g.startsWith("/"));
  return globs.length > 0 ? globs : DEFAULT_JUNK_GLOBS;
}
```

Add `junk: string[];` to `WorktreeRepoConfig` and `junk: sanitizeJunk(declared.junk),` in `loadWorktreeRepoConfig` next to `staleClaimDays`. Update every object literal typed `WorktreeRepoConfig` that `bunx tsc --noEmit` flags (e.g. `cfgWith` in `stale-claims.test.ts`) with `junk: DEFAULT_JUNK_GLOBS`. In `registry-defs.ts`, add to the `rt.worktrees` description: `junk (untracked globs a merged tree may discard on dispose)`.

- [ ] **Step 4: Implement `lib/worktree/dirt-class.ts`**

```ts
import { runGit } from "./git-async.ts";

export type DirtKind = "none" | "junk" | "lockfile" | "real";
export interface DirtClass { kind: DirtKind; files: string[]; discardable: string[] }

const LOCKFILES = new Set(["bun.lock", "pnpm-lock.yaml"]);
const VERSION_LINE = /^[+-]\s*"?version"?:\s*"?[^"\s]+"?,?\s*$/;

export function isVersionOnlyLockDiff(unifiedDiff: string): boolean {
  const changed = unifiedDiff
    .split("\n")
    .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"));
  return changed.length > 0 && changed.every((l) => VERSION_LINE.test(l));
}

/** NUL-separated so a path with spaces or quotes arrives verbatim. */
async function lines0(cwd: string, args: string[]): Promise<string[] | null> {
  const r = await runGit(cwd, [...args, "-z"]);
  return r.exitCode === 0 ? r.stdout.split("\0").filter(Boolean) : null;
}

export async function classifyDirtForTriage(treePath: string, junkGlobs: string[]): Promise<DirtClass> {
  const tracked = await lines0(treePath, ["diff", "--name-only", "HEAD"]);
  const untracked = await lines0(treePath, ["ls-files", "--others", "--exclude-standard"]);
  if (tracked === null || untracked === null) return { kind: "real", files: ["<status-failed>"], discardable: [] };
  const files = [...tracked, ...untracked];
  if (files.length === 0) return { kind: "none", files, discardable: [] };

  const globs = junkGlobs.map((g) => new Bun.Glob(g));
  const junk = untracked.filter((f) => globs.some((g) => g.match(f)));
  if (junk.length !== untracked.length) return { kind: "real", files, discardable: [] };
  if (tracked.length === 0) return { kind: "junk", files, discardable: junk };

  if (!tracked.every((f) => LOCKFILES.has(f))) return { kind: "real", files, discardable: [] };
  for (const f of tracked) {
    const diff = await runGit(treePath, ["diff", "-U0", "HEAD", "--", f]);
    if (diff.exitCode !== 0 || !isVersionOnlyLockDiff(diff.stdout)) return { kind: "real", files, discardable: [] };
  }
  return { kind: "lockfile", files, discardable: [...tracked, ...junk] };
}
```

If `runGit` returns a stdout with a trailing newline around the NUL list, the `filter(Boolean)` already drops the empty tail; if it trims stdout, NUL-separated output is unaffected.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/worktree/__tests__/dirt-class.test.ts lib/worktree lib/daemon/reconciler && bunx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/worktree/dirt-class.ts lib/worktree/config.ts lib/worktree/__tests__ packages/rt-client/src/settings/registry-defs.ts lib/daemon/reconciler/__tests__/stale-claims.test.ts
git commit -m "worktree: rt.worktrees.junk and a triage dirt classifier"
```

---

### Task 3: Keep record and fingerprint

**Files:**
- Modify: `lib/worktree/registry.ts` (`TreeRecord`)
- Create: `lib/worktree/triage/fingerprint.ts`
- Test: `lib/worktree/triage/__tests__/fingerprint.test.ts`

**Interfaces:**
- Consumes: `classifyDirtForTriage` (Task 2) for the dirt hash input
- Produces:
  - `TreeRecord.kept?: KeepRecord` with `export interface KeepRecord { keptAt: string; headSha: string; dirtHash: string; mrState: string | null }` (in `registry.ts`)
  - `export interface Fingerprint { headSha: string; dirtHash: string; mrState: string | null }`
  - `export function dirtHash(files: string[]): string`
  - `export function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean`
  - `export function keepStillHolds(kept: KeepRecord, now: Fingerprint): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, test, expect } from "bun:test";
import { dirtHash, keepStillHolds, sameFingerprint } from "../fingerprint.ts";

const fp = { headSha: "a1", dirtHash: dirtHash(["x.ts"]), mrState: "closed" };

describe("fingerprint", () => {
  test("dirt hash ignores order", () => {
    expect(dirtHash(["b", "a"])).toBe(dirtHash(["a", "b"]));
    expect(dirtHash([])).not.toBe(dirtHash(["a"]));
  });

  test("any field change breaks the fingerprint", () => {
    expect(sameFingerprint(fp, { ...fp })).toBe(true);
    expect(sameFingerprint(fp, { ...fp, headSha: "a2" })).toBe(false);
    expect(sameFingerprint(fp, { ...fp, dirtHash: dirtHash(["y.ts"]) })).toBe(false);
    expect(sameFingerprint(fp, { ...fp, mrState: "opened" })).toBe(false);
  });

  test("a keep holds only while the tree is unchanged", () => {
    const kept = { keptAt: "2026-09-24T00:00:00Z", ...fp };
    expect(keepStillHolds(kept, fp)).toBe(true);
    expect(keepStillHolds(kept, { ...fp, headSha: "new" })).toBe(false);
    expect(keepStillHolds(kept, { ...fp, dirtHash: dirtHash([]) })).toBe(false);
    expect(keepStillHolds(kept, { ...fp, mrState: "opened" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/worktree/triage/__tests__/fingerprint.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`lib/worktree/registry.ts`, next to `TreeRecord`:

```ts
export interface KeepRecord { keptAt: string; headSha: string; dirtHash: string; mrState: string | null }
```

and in `TreeRecord`: `kept?: KeepRecord; // set by worktree:keep; triage drops it once the tree changes`.

`lib/worktree/triage/fingerprint.ts`:

```ts
import { createHash } from "crypto";
import type { KeepRecord } from "../registry.ts";

export interface Fingerprint { headSha: string; dirtHash: string; mrState: string | null }

export function dirtHash(files: string[]): string {
  return createHash("sha256").update([...files].sort().join("\0")).digest("hex").slice(0, 16);
}

export function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
  return a.headSha === b.headSha && a.dirtHash === b.dirtHash && a.mrState === b.mrState;
}

export function keepStillHolds(kept: KeepRecord, now: Fingerprint): boolean {
  return sameFingerprint(kept, now);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/worktree/triage/__tests__/fingerprint.test.ts && bunx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/worktree/registry.ts lib/worktree/triage
git commit -m "worktree: keep record and triage fingerprint"
```

---

### Task 4: Pure triage verdict

**Files:**
- Create: `lib/worktree/triage/verdict.ts`
- Test: `lib/worktree/triage/__tests__/verdict.test.ts`

**Interfaces:**
- Consumes: `Containment` (Task 1), `DirtClass` (Task 2), `KeepRecord`, `Fingerprint`, `keepStillHolds` (Task 3)
- Produces (these exact names are used by Tasks 5, 6, 8 and mirrored in Swift Task 9):

```ts
export type TriageGroup = "safe" | "look" | "only-copy" | "waiting" | "broken" | "kept";
export type TriageAction = "dispose" | "review" | "push-branch" | "keep" | "unkeep" | "stop-process"
  | "open-herd" | "open-run" | "remove" | "open-finder" | "open-terminal" | "copy-path";
export type PushKind = "pushed" | "in-main" | "remote-deleted" | "unpushed";
export interface TriageHold { kind: "process" | "orphan-stopping" | "herd" | "run"; detail: string }
export interface TriageFacts {
  repo: string; tree: string; path: string; branch: string | null;
  broken: boolean;
  mr: { iid: number; state: "opened" | "merged" | "closed"; title: string; at: string | null } | null;
  ticket: { identifier: string; title: string; stateName: string | null } | null;
  remoteBranchExists: boolean; ahead: number;
  containment: Containment; dirt: DirtClass; fingerprint: Fingerprint;
  kept: KeepRecord | null; hold: TriageHold | null;
}
export interface TriageRow {
  repo: string; tree: string; path: string; branch: string | null;
  mr: TriageFacts["mr"]; ticket: TriageFacts["ticket"];
  push: { kind: PushKind; ahead?: number };
  containment: Containment; dirt: { kind: DirtKind; files: string[] };
  group: TriageGroup; verdict: string; actions: TriageAction[];
  hold?: TriageHold; keptAt?: string; fingerprint: Fingerprint;
}
export interface TriageCounts { needsDecision: number; safe: number; waiting: number; kept: number }
export function triageRow(f: TriageFacts): TriageRow;
export function triageCounts(rows: TriageRow[]): TriageCounts;
```

- [ ] **Step 1: Write the failing tests (one per catalog state, plus counts)**

```ts
import { describe, test, expect } from "bun:test";
import { triageCounts, triageRow, type TriageFacts } from "../verdict.ts";

const base: TriageFacts = {
  repo: "github.com/m4ttstack/rt", tree: "t", path: "/p/t", branch: "b", broken: false,
  mr: { iid: 1, state: "merged", title: "x", at: null }, ticket: null,
  remoteBranchExists: true, ahead: 0, containment: "on-remote",
  dirt: { kind: "none", files: [], discardable: [] },
  fingerprint: { headSha: "h", dirtHash: "d", mrState: "merged" }, kept: null, hold: null,
};
const row = (o: Partial<TriageFacts>) => triageRow({ ...base, ...o });

describe("triageRow", () => {
  test("generated junk with every commit in main is safe, dispose first", () => {
    const r = row({ containment: "in-default", remoteBranchExists: false, dirt: { kind: "junk", files: [".visual/a.png"], discardable: [".visual/a.png"] } });
    expect([r.group, r.push.kind, r.actions[0]]).toEqual(["safe", "in-main", "dispose"]);
  });
  test("a lockfile-only rewrite is safe", () => {
    expect(row({ dirt: { kind: "lockfile", files: ["bun.lock"], discardable: ["bun.lock"] } }).group).toBe("safe");
  });
  test("a rebased-then-merged branch with the remote deleted is safe", () => {
    const r = row({ containment: "patch-identical", remoteBranchExists: false, ahead: 8 });
    expect([r.group, r.push.kind]).toEqual(["safe", "remote-deleted"]);
  });
  test("a closed MR whose remote has every commit is safe", () => {
    expect(row({ mr: { iid: 2, state: "closed", title: "x", at: null } }).group).toBe("safe");
  });
  test("no MR but every commit in main is safe", () => {
    expect(row({ mr: null, containment: "in-default" }).group).toBe("safe");
  });
  test("a real uncommitted file needs a look, review first", () => {
    const r = row({ dirt: { kind: "real", files: ["a.test.ts"], discardable: [] } });
    expect([r.group, r.actions[0]]).toEqual(["look", "review"]);
  });
  test("unpushed work with no remote is the only copy, push first", () => {
    const r = row({ containment: "none", remoteBranchExists: false, ahead: 19, mr: { iid: 3, state: "closed", title: "x", at: null } });
    expect([r.group, r.push, r.actions[0]]).toEqual(["only-copy", { kind: "unpushed", ahead: 19 }, "push-branch"]);
    expect(r.actions).toContain("keep");
    expect(r.actions).not.toContain("dispose");
  });
  test.each([
    ["process", "stop-process"], ["herd", "open-herd"], ["run", "open-run"],
  ] as const)("a %s hold is waiting with %s", (kind, action) => {
    const r = row({ hold: { kind, detail: "d" }, containment: "none" });
    expect([r.group, r.actions[0]]).toEqual(["waiting", action]);
  });
  test("a stale orphan being stopped is waiting with no primary action", () => {
    const r = row({ hold: { kind: "orphan-stopping", detail: "d" } });
    expect(r.group).toBe("waiting");
    expect(r.actions.every((a) => ["open-finder", "open-terminal", "copy-path"].includes(a))).toBe(true);
  });
  test("a broken tree beats every other state and only offers remove", () => {
    const r = row({ broken: true, containment: "none", hold: { kind: "process", detail: "d" } });
    expect([r.group, r.actions]).toEqual(["broken", ["remove", "copy-path"]]);
  });
  test("a keep holds while the fingerprint matches, and lapses when it doesn't", () => {
    const kept = { keptAt: "2026-09-24T00:00:00Z", headSha: "h", dirtHash: "d", mrState: "merged" };
    expect(row({ kept, containment: "none" }).group).toBe("kept");
    expect(row({ kept, containment: "none" }).actions[0]).toBe("unkeep");
    expect(row({ kept: { ...kept, headSha: "old" }, containment: "none" }).group).toBe("only-copy");
  });
  test("every row names its verdict in one sentence", () => {
    for (const r of [row({}), row({ containment: "none" }), row({ broken: true })]) expect(r.verdict).toMatch(/^[A-Z].*\.$/);
  });
});

describe("triageCounts", () => {
  test("waiting and kept never count toward needsDecision; broken does", () => {
    const rows = [row({}), row({ containment: "none" }), row({ broken: true }), row({ hold: { kind: "herd", detail: "d" } }),
      row({ kept: { keptAt: "x", headSha: "h", dirtHash: "d", mrState: "merged" }, containment: "none" })];
    expect(triageCounts(rows)).toEqual({ needsDecision: 3, safe: 1, waiting: 1, kept: 1 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/worktree/triage/__tests__/verdict.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/worktree/triage/verdict.ts`**

```ts
import type { Containment } from "../containment.ts";
import type { DirtClass, DirtKind } from "../dirt-class.ts";
import type { KeepRecord } from "../registry.ts";
import { keepStillHolds, type Fingerprint } from "./fingerprint.ts";

export type TriageGroup = "safe" | "look" | "only-copy" | "waiting" | "broken" | "kept";
export type TriageAction = "dispose" | "review" | "push-branch" | "keep" | "unkeep" | "stop-process"
  | "open-herd" | "open-run" | "remove" | "open-finder" | "open-terminal" | "copy-path";
export type PushKind = "pushed" | "in-main" | "remote-deleted" | "unpushed";
export interface TriageHold { kind: "process" | "orphan-stopping" | "herd" | "run"; detail: string }
export interface TriageFacts {
  repo: string; tree: string; path: string; branch: string | null;
  broken: boolean;
  mr: { iid: number; state: "opened" | "merged" | "closed"; title: string; at: string | null } | null;
  ticket: { identifier: string; title: string; stateName: string | null } | null;
  remoteBranchExists: boolean; ahead: number;
  containment: Containment; dirt: DirtClass; fingerprint: Fingerprint;
  kept: KeepRecord | null; hold: TriageHold | null;
}
export interface TriageRow {
  repo: string; tree: string; path: string; branch: string | null;
  mr: TriageFacts["mr"]; ticket: TriageFacts["ticket"];
  push: { kind: PushKind; ahead?: number };
  containment: Containment; dirt: { kind: DirtKind; files: string[] };
  group: TriageGroup; verdict: string; actions: TriageAction[];
  hold?: TriageHold; keptAt?: string; fingerprint: Fingerprint;
}
export interface TriageCounts { needsDecision: number; safe: number; waiting: number; kept: number }

const TAIL: TriageAction[] = ["open-finder", "open-terminal", "copy-path"];

function pushOf(f: TriageFacts): TriageRow["push"] {
  if (f.containment === "in-default") return { kind: "in-main" };
  if (f.containment === "on-remote") return { kind: "pushed" };
  if (f.containment === "patch-identical" && !f.remoteBranchExists) return { kind: "remote-deleted" };
  if (f.containment === "patch-identical") return { kind: "pushed" };
  return { kind: "unpushed", ahead: f.ahead };
}

function groupOf(f: TriageFacts): TriageGroup {
  if (f.broken) return "broken";
  if (f.kept && keepStillHolds(f.kept, f.fingerprint)) return "kept";
  if (f.hold) return "waiting";
  if (f.containment === "none") return "only-copy";
  if (f.dirt.kind === "real") return "look";
  return "safe";
}

function safeVerdict(f: TriageFacts): string {
  const where = f.containment === "in-default" ? "Every commit is in main."
    : f.containment === "patch-identical" ? `Rebased before merge, and all ${f.ahead} commits match the merged PR.`
    : f.mr?.state === "closed" ? "The PR was closed, but the remote branch has every commit."
    : "Every commit is on the remote.";
  if (f.dirt.kind === "junk") return `${where} Only generated files are left.`;
  if (f.dirt.kind === "lockfile") return `${where} Only bun.lock changed, rewritten by install.`;
  return where;
}

function verdictOf(f: TriageFacts, group: TriageGroup): string {
  switch (group) {
    case "broken": return "Its repo or git directory is gone. Nothing to recover.";
    case "kept": return "Kept. Comes back here if it changes.";
    case "waiting": return `Waiting: ${f.hold!.detail}.`;
    case "only-copy": return "Only copy of this work. Push the branch to keep it, or dispose to drop it.";
    case "look": return `${f.dirt.files.length === 1 ? "One uncommitted file" : `${f.dirt.files.length} uncommitted files`}: ${f.dirt.files.slice(0, 2).join(", ")}. Review before disposing.`;
    case "safe": return safeVerdict(f);
  }
}

function actionsOf(f: TriageFacts, group: TriageGroup): TriageAction[] {
  switch (group) {
    case "broken": return ["remove", "copy-path"];
    case "kept": return ["unkeep", ...TAIL];
    case "waiting": {
      const lead: Record<TriageHold["kind"], TriageAction[]> = { process: ["stop-process"], herd: ["open-herd"], run: ["open-run"], "orphan-stopping": [] };
      return [...lead[f.hold!.kind], ...TAIL];
    }
    case "only-copy": return ["push-branch", "keep", "dispose", ...TAIL];
    case "look": return ["review", "keep", ...TAIL];
    case "safe": return ["dispose", "keep", ...TAIL];
  }
}

export function triageRow(f: TriageFacts): TriageRow {
  const group = groupOf(f);
  return {
    repo: f.repo, tree: f.tree, path: f.path, branch: f.branch, mr: f.mr, ticket: f.ticket,
    push: pushOf(f), containment: f.containment, dirt: { kind: f.dirt.kind, files: f.dirt.files },
    group, verdict: verdictOf(f, group), actions: actionsOf(f, group),
    ...(f.hold ? { hold: f.hold } : {}),
    ...(group === "kept" && f.kept ? { keptAt: f.kept.keptAt } : {}),
    fingerprint: f.fingerprint,
  };
}

export function triageCounts(rows: TriageRow[]): TriageCounts {
  const n = (g: TriageGroup) => rows.filter((r) => r.group === g).length;
  return { needsDecision: n("safe") + n("look") + n("only-copy") + n("broken"), safe: n("safe"), waiting: n("waiting"), kept: n("kept") };
}
```

`dispose` on an `only-copy` row is the row-menu **Dispose anyway**; the tray renders it red and sends `confirmOnlyCopy` (Task 6). The `test.each` for `orphan-stopping` and the `verdict` sentence check both pass with this code; if a verdict string is edited later, keep it one sentence ending in a period.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/worktree/triage/__tests__/verdict.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/worktree/triage/verdict.ts lib/worktree/triage/__tests__/verdict.test.ts
git commit -m "worktree: pure triage verdict (groups, verdicts, actions, counts)"
```

---

### Task 5: Fact collector and the `worktree:triage` verb

**Files:**
- Create: `lib/worktree/triage/facts.ts`, `lib/daemon/handlers/worktree-triage.ts`
- Modify: `packages/rt-client/src/commands.ts` (types near `WorktreeAdoptData` :508, `Commands` near :878, `COMMAND_NAMES` near :1002), `lib/daemon/command-router.ts` (spread after `...worktreeHandlers` :231), `lib/daemon/handlers/worktree.ts` (export `decodeRepo`, `targetRepos` if not already exported)
- Test: `lib/worktree/triage/__tests__/facts.test.ts`, `lib/daemon/__tests__/worktree-triage-handlers.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4; `herdJobTreeHold` (`lib/daemon/reconciler/job-release.ts`); `RunningRunScan` finder; `loadWorktreeRepoConfig`; `branchOf`/composite cache keys as `worktree:list` uses them (`composeKey(repoName, branch)` then bare fallback).
- Produces:
  - `export interface TriageDeps { cacheEntries: Record<string, any>; jobTreeHold: (rec: TreeRecord) => string | null; findRunningRun: (worktree: string) => RunningRunScan; fetch?: (treePath: string, sha: string) => Promise<boolean> }`
  - `export async function collectFacts(repo: string, repoPath: string, rec: TreeRecord, deps: TriageDeps): Promise<TriageFacts>`
  - `export function isStuck(rec: TreeRecord, mrState: string | null, broken: boolean): boolean`
  - `export async function triageRepo(repo: string, repoPath: string, deps: TriageDeps): Promise<TriageRow[]>`
  - `export function createWorktreeTriageHandlers(ctx: Pick<HandlerContext, "repoIndex" | "cache" | "log">, opts: { findRunningRunByWorktree: WorktreeHandlerOpts["findRunningRunByWorktree"]; jobTreeHold: (rec: TreeRecord) => string | null; kick: () => void; emit: (t: string, d: unknown) => void })`
  - rt-client: `WorktreeTriageData = { rows: TriageRow[]; banners: Array<{ repo: string; path: string } & MergeCleanupGap>; counts: TriageCounts }` and `"worktree:triage": { payload: { repoName?: string }; data: WorktreeTriageData }` (mirror the `TriageRow` shape as a plain interface in `commands.ts`; rt-client must not import from `lib/`)

- [ ] **Step 1: Write the failing tests**

`lib/worktree/triage/__tests__/facts.test.ts` (reuse the reactor test's repo helpers: `makeRepo`, `addBareOrigin`, `ephemeralTree` pattern; copy them into a local `__tests__/helpers.ts` if they are not already shared):

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../../../state/index.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../registry.ts";
import { collectFacts, isStuck, triageRepo, type TriageDeps } from "../facts.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const sh = (c: string, cwd?: string) => execSync(c, { cwd, shell: "/bin/zsh", stdio: "pipe" }).toString().trim();
const repoName = "github.com/acme/app";

let repo: string;
function tree(name: string, opts: { push?: boolean; state?: "claimed" | "disposable"; reason?: string } = {}): TreeRecord {
  const path = join(repo, ".worktrees", name);
  sh(`git -C ${repo} worktree add -q -b feat-${name} ${path} origin/main`);
  writeFileSync(join(path, `${name}.txt`), "w\n");
  sh(`git add -A && git ${GIT_ID} commit -q -m w`, path);
  if (opts.push !== false) sh(`git push -q origin feat-${name}`, path);
  const rec: TreeRecord = { name, path, kind: "ephemeral", state: opts.state ?? "claimed", branch: `feat-${name}`, disposal: "merge", createdAt: "2026-09-20T00:00:00Z", claimedAt: "2026-09-20T00:00:00Z", ...(opts.reason ? { disposableReason: opts.reason } : {}) };
  saveRegistry(repoName, [...loadRegistry(repoName), rec]);
  return rec;
}
const deps = (entries: Record<string, any> = {}): TriageDeps => ({
  cacheEntries: entries, jobTreeHold: () => null, findRunningRun: () => ({ kind: "none" }), fetch: async () => false,
});
const merged = (name: string, extra: object = {}) => ({ [`feat-${name}`]: { repoName, mr: { iid: 7, state: "merged", title: `T ${name}`, sha: null, ...extra } } });

beforeEach(() => {
  process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rttriage-home-")));
  closeStateDb();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "rttriage-")));
  sh(`git init -q -b main ${repo}`);
  sh(`git ${GIT_ID} commit -q --allow-empty -m init`, repo);
  const bare = mkdtempSync(join(tmpdir(), "rttriage-bare-"));
  sh(`git clone -q --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch -q origin`);
});

describe("isStuck", () => {
  const rec = { kind: "ephemeral", state: "claimed" } as TreeRecord;
  test("claimed with merged/closed MR, any disposable, or broken", () => {
    expect(isStuck(rec, "merged", false)).toBe(true);
    expect(isStuck(rec, "closed", false)).toBe(true);
    expect(isStuck(rec, "opened", false)).toBe(false);
    expect(isStuck(rec, null, false)).toBe(false);
    expect(isStuck({ ...rec, state: "disposable" }, null, false)).toBe(true);
    expect(isStuck(rec, null, true)).toBe(true);
    expect(isStuck({ ...rec, kind: "main" }, "merged", false)).toBe(false);
  });
});

describe("collectFacts", () => {
  test("a pushed merged tree with a screenshot folder: on-remote, junk, MR joined", async () => {
    const rec = tree("alpha");
    mkdirSync(join(rec.path, ".visual"));
    writeFileSync(join(rec.path, ".visual", "a.png"), "x");
    const f = await collectFacts(repoName, repo, rec, deps(merged("alpha")));
    expect([f.containment, f.dirt.kind, f.mr?.title, f.broken]).toEqual(["on-remote", "junk", "T alpha", false]);
  });

  test("an unpushed tree reports how far ahead it is", async () => {
    const rec = tree("bravo", { push: false });
    const f = await collectFacts(repoName, repo, rec, deps(merged("bravo")));
    expect([f.containment, f.remoteBranchExists, f.ahead]).toEqual(["none", false, 1]);
  });

  test("a tree whose directory vanished is broken", async () => {
    const rec = tree("charlie");
    rmSync(rec.path, { recursive: true, force: true });
    expect((await collectFacts(repoName, repo, rec, deps(merged("charlie")))).broken).toBe(true);
  });

  test("a held tree carries its hold: reactor held reason, then herd, then live run", async () => {
    const rec = tree("delta");
    saveRegistry(repoName, loadRegistry(repoName).map((t) => (t.path === rec.path ? { ...t, heldReason: "pid 7 (vim) has its cwd inside" } : t)));
    const f1 = await collectFacts(repoName, repo, { ...rec, heldReason: "pid 7 (vim) has its cwd inside" }, deps(merged("delta")));
    expect(f1.hold).toEqual({ kind: "process", detail: "pid 7 (vim) has its cwd inside" });
    const jobRec = { ...rec, disposal: "job" as const, owner: "herd:h1" };
    const f2 = await collectFacts(repoName, repo, jobRec, { ...deps(merged("delta")), jobTreeHold: () => "herd job h1/delta is at-gate" });
    expect(f2.hold).toEqual({ kind: "herd", detail: "herd job h1/delta is at-gate" });
    const f3 = await collectFacts(repoName, repo, rec, { ...deps(merged("delta")), findRunningRun: () => ({ kind: "match", run: { id: "r1", currentStage: "implement" } }) as any });
    expect(f3.hold).toEqual({ kind: "run", detail: "pipeline run r1 is live at implement" });
  });
});

describe("triageRepo", () => {
  test("lists only stuck trees", async () => {
    tree("echo");
    tree("foxtrot");
    const rows = await triageRepo(repoName, repo, deps(merged("echo")));
    expect(rows.map((r) => r.tree)).toEqual(["echo"]);
  });
});
```

`lib/daemon/__tests__/worktree-triage-handlers.test.ts`: build handlers with a fake ctx (`repoIndex: () => ({ [repoName]: repo })`, `cache: { entries }`, `log`), register one merged tree as in `facts.test.ts`, then:

```ts
  test("worktree:triage returns rows, counts and banners", async () => {
    const res = await handlers["worktree:triage"]({});
    expect(res.ok).toBe(true);
    expect(res.data.rows).toHaveLength(1);
    expect(res.data.counts.needsDecision).toBe(1);
    expect(Array.isArray(res.data.banners)).toBe(true);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/worktree/triage/__tests__/facts.test.ts lib/daemon/__tests__/worktree-triage-handlers.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `lib/worktree/triage/facts.ts`**

```ts
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { RunningRunScan } from "../../runs/store.ts";
import { composeKey } from "../../state/branch-cache.ts";
import { loadWorktreeRepoConfig } from "../config.ts";
import { containmentOf } from "../containment.ts";
import { classifyDirtForTriage } from "../dirt-class.ts";
import { headSha, remoteDefaultRef, remoteRefExists, runGit } from "../git-async.ts";
import { loadRegistry, type TreeRecord } from "../registry.ts";
import { dirtHash } from "./fingerprint.ts";
import { triageRow, type TriageFacts, type TriageHold, type TriageRow } from "./verdict.ts";

export interface TriageDeps {
  cacheEntries: Record<string, any>;
  jobTreeHold: (rec: TreeRecord) => string | null;
  findRunningRun: (worktree: string) => RunningRunScan;
  fetch?: (treePath: string, sha: string) => Promise<boolean>;
}

export function isStuck(rec: TreeRecord, mrState: string | null, broken: boolean): boolean {
  if (rec.kind !== "ephemeral") return false;
  if (broken) return true;
  if (rec.state === "disposable") return true;
  return rec.state === "claimed" && (mrState === "merged" || mrState === "closed");
}

function isBroken(rec: TreeRecord): boolean {
  if (!existsSync(rec.path)) return true;
  const dotGit = join(rec.path, ".git");
  if (!existsSync(dotGit)) return true;
  if (statSync(dotGit).isFile()) {
    const m = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
    return !m || !existsSync(m[1]!.trim());
  }
  return false;
}

function cacheEntry(repo: string, branch: string | null, entries: Record<string, any>): any {
  if (!branch) return null;
  const e = entries[composeKey(repo, branch)] ?? entries[branch];
  return e && (!e.repoName || e.repoName === repo) ? e : null;
}

function holdOf(rec: TreeRecord, deps: TriageDeps): TriageHold | null {
  if (rec.heldReason) {
    return rec.heldReason.startsWith("stopped stale orphan")
      ? { kind: "orphan-stopping", detail: rec.heldReason }
      : { kind: "process", detail: rec.heldReason };
  }
  if (rec.disposal === "job") {
    const h = deps.jobTreeHold(rec);
    if (h) return { kind: "herd", detail: h };
  }
  const run = deps.findRunningRun(rec.path);
  if (run.kind === "match") return { kind: "run", detail: `pipeline run ${run.run.id} is live at ${run.run.currentStage}` };
  return null;
}

export async function collectFacts(repo: string, repoPath: string, rec: TreeRecord, deps: TriageDeps): Promise<TriageFacts> {
  const entry = cacheEntry(repo, rec.branch, deps.cacheEntries);
  const mrRaw = entry?.mr ?? null;
  const mr = mrRaw ? { iid: mrRaw.iid, state: mrRaw.state, title: mrRaw.title, at: mrRaw.mergedAt ?? mrRaw.closedAt ?? mrRaw.updatedAt ?? null } : null;
  const ticket = entry?.ticket ? { identifier: entry.ticket.identifier, title: entry.ticket.title, stateName: entry.ticket.stateName ?? null } : null;
  const empty = { kind: "none" as const, files: [], discardable: [] };
  if (isBroken(rec)) {
    return { repo, tree: rec.name, path: rec.path, branch: rec.branch, broken: true, mr, ticket, remoteBranchExists: false, ahead: 0,
      containment: "none", dirt: empty, fingerprint: { headSha: "", dirtHash: dirtHash([]), mrState: mr?.state ?? null }, kept: rec.kept ?? null, hold: null };
  }
  const cfg = await loadWorktreeRepoConfig(repo, repoPath);
  const dirt = await classifyDirtForTriage(rec.path, cfg.junk);
  const fetch = deps.fetch ? (sha: string) => deps.fetch!(rec.path, sha) : undefined;
  const containment = await containmentOf(rec.path, rec.branch, mrRaw ? { state: mrRaw.state, sha: mrRaw.sha } : null, fetch);
  const remoteBranchExists = rec.branch ? await remoteRefExists(rec.path, rec.branch) : false;
  const ahead = Number((await runGit(rec.path, ["rev-list", "--count", `${await remoteDefaultRef(rec.path)}..HEAD`])).stdout.trim()) || 0;
  return {
    repo, tree: rec.name, path: rec.path, branch: rec.branch, broken: false, mr, ticket, remoteBranchExists, ahead, containment, dirt,
    fingerprint: { headSha: (await headSha(rec.path)) ?? "", dirtHash: dirtHash(dirt.files), mrState: mr?.state ?? null },
    kept: rec.kept ?? null, hold: holdOf(rec, deps),
  };
}

export async function triageRepo(repo: string, repoPath: string, deps: TriageDeps): Promise<TriageRow[]> {
  const rows: TriageRow[] = [];
  for (const rec of loadRegistry(repo)) {
    if (rec.kind !== "ephemeral") continue;
    const broken = isBroken(rec);
    const mrState = cacheEntry(repo, rec.branch, deps.cacheEntries)?.mr?.state ?? null;
    if (!isStuck(rec, mrState, broken)) continue;
    rows.push(triageRow(await collectFacts(repo, repoPath, rec, deps)));
  }
  return rows;
}
```

Before writing `mr.at`, open `node_modules/@mattstack/glance` (`grep -rn "MRDashboardProps" node_modules/@mattstack/glance --include=*.d.ts`) and use the real merged/closed timestamp field names; keep `null` when none exists. Confirm `composeKey` is exported from `lib/state/branch-cache.ts` (it is what `worktree:list` uses at `handlers/worktree.ts:712`); if it lives elsewhere, import from there.

- [ ] **Step 4: Implement the verb, the types, and the router wiring**

`lib/daemon/handlers/worktree-triage.ts`:

```ts
import type { Logger } from "pino";
import type { RunningRunScan } from "../../runs/store.ts";
import type { TreeRecord } from "../../worktree/registry.ts";
import { triageRepo } from "../../worktree/triage/facts.ts";
import { triageCounts, type TriageRow } from "../../worktree/triage/verdict.ts";
import { loadRepoTracking } from "../../repo-tracking.ts";
import { loadSecrets } from "../../secrets.ts";
import { mergeCleanupGap } from "../../worktree/merge-cleanup-gap.ts";
import { targetRepos } from "./worktree.ts";

export interface WorktreeTriageOpts {
  findRunningRunByWorktree: (worktree: string) => RunningRunScan;
  jobTreeHold: (rec: TreeRecord) => string | null;
  kick: () => void;
  emit: (type: string, data: unknown) => void;
}

export function createWorktreeTriageHandlers(
  ctx: { repoIndex: () => Record<string, string>; cache: { entries: Record<string, any> }; log: Logger },
  opts: WorktreeTriageOpts,
) {
  const deps = () => ({ cacheEntries: ctx.cache.entries, jobTreeHold: opts.jobTreeHold, findRunningRun: opts.findRunningRunByWorktree });
  return {
    "worktree:triage": async (payload: any) => {
      const repos = targetRepos(ctx, payload?.repoName);
      if (repos.length === 0 && payload?.repoName) return { ok: false, error: "repo-unknown" };
      const rows: TriageRow[] = [];
      const banners: unknown[] = [];
      const tracking = (() => { try { return loadRepoTracking(); } catch { return null; } })();
      const secrets = await loadSecrets().catch(() => null);
      for (const [repo, path] of repos) {
        try {
          rows.push(...(await triageRepo(repo, path, deps())));
        } catch (err) {
          ctx.log.warn({ err, repo }, "worktree:triage: repo failed");
        }
        const gap = await mergeCleanupGap(repo, path, tracking, secrets);
        if (gap) banners.push({ repo, path, ...gap });
      }
      return { ok: true, data: { rows, banners, counts: triageCounts(rows) } };
    },
  };
}
```

Match the import paths for `loadRepoTracking`, `loadSecrets` and `mergeCleanupGap` to the ones `lib/daemon/handlers/worktree.ts` already uses for its `mergeCleanupOff` block (copy its import lines verbatim). Export `targetRepos` from `handlers/worktree.ts` if it is not exported.

In `lib/daemon/command-router.ts`, after `const worktreeHandlers = ...` (:161):

```ts
  const worktreeTriageHandlers = createWorktreeTriageHandlers(
    { repoIndex: ctx.repoIndex, cache: ctx.cache, log: ctx.log },
    {
      findRunningRunByWorktree: opts.worktree.findRunningRunByWorktree,
      jobTreeHold: (rec) => herdJobTreeHold(opts.herdStore, rec),
      kick: opts.worktree.kick,
      emit: opts.worktree.emit,
    },
  );
```

and `...worktreeTriageHandlers,` right after `...worktreeHandlers,` (:231). Import `herdJobTreeHold` from `./reconciler/job-release.ts`.

In `packages/rt-client/src/commands.ts`, add the `TriageRow`/`TriageCounts` interfaces (same fields as Task 4, written out as plain types), `WorktreeTriageData`, the `"worktree:triage"` entry in `Commands`, and `"worktree:triage"` in `COMMAND_NAMES`. Then `cd packages/rt-client && bun run build`.

- [ ] **Step 5: Run to verify they pass**

Run: `bun test lib/worktree/triage lib/daemon/__tests__/worktree-triage-handlers.test.ts lib/daemon/__tests__/rt-client-commands.test.ts packages/rt-client && bunx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/worktree/triage lib/daemon/handlers/worktree-triage.ts lib/daemon/handlers/worktree.ts lib/daemon/command-router.ts lib/daemon/__tests__/worktree-triage-handlers.test.ts packages/rt-client/src/commands.ts
git commit -m "daemon: worktree:triage lists stuck trees with verdicts"
```

---

### Task 6: Guarded action verbs

**Files:**
- Modify: `lib/daemon/handlers/worktree-triage.ts`, `packages/rt-client/src/commands.ts`
- Test: extend `lib/daemon/__tests__/worktree-triage-handlers.test.ts`

**Interfaces:**
- Consumes: `collectFacts`, `triageRow`, `sameFingerprint`, `disposeTree`, `withTreeLock`, `patchTree`, `findByName` (or a `loadRegistry(repo).find(t => t.name === tree)`), `killWorktreeProcesses`
- Produces verbs (all return `{ ok: false, error: "changed" }` when the fingerprint no longer matches, `"tree-unknown"` for a missing tree):
  - `worktree:triage-dispose { repoName, tree, fingerprint, discard?: "classified" | "all", confirmOnlyCopy?: boolean }` → `{ ok: true, data: { disposed: true, trash?: { path, keptUntil } } }` or `{ ok: false, error: <refusal> }`
  - `worktree:keep { repoName, tree, fingerprint }` / `worktree:unkeep { repoName, tree }` → `{ ok: true, data: { tree } }`
  - `worktree:push-branch { repoName, tree, fingerprint, commitDirty?: boolean, message?: string }` → `{ ok: true, data: { row: TriageRow } }`
  - `worktree:triage-diff { repoName, tree }` → `{ ok: true, data: { files: Array<{ path: string; status: "modified" | "untracked"; diff: string; truncated: boolean }> } }` (diff capped at 400 lines per file)
  - `worktree:triage-remove { repoName, tree }` (broken rows only) → `{ ok: true, data: { removed: true } }`
  - `worktree:stop-holders { repoName, tree }` → `{ ok: true, data: { terminated: Array<{ pid: number; label: string }> } }`

- [ ] **Step 1: Write the failing tests**

Add to `worktree-triage-handlers.test.ts` (helpers `tree(...)`, `merged(...)` as in Task 5; `rowFor(name)` calls `worktree:triage` and returns the row):

```ts
  test("a safe junk-only tree disposes and loses exactly its classified files", async () => {
    const rec = tree("golf");
    mkdirSync(join(rec.path, ".visual"));
    writeFileSync(join(rec.path, ".visual", "a b.png"), "x");
    const r = await rowFor("golf");
    const res = await handlers["worktree:triage-dispose"]({ repoName, tree: "golf", fingerprint: r.fingerprint, discard: "classified" });
    expect(res.ok).toBe(true);
    expect(loadRegistry(repoName).find((t) => t.name === "golf")).toBeUndefined();
  });

  test("a stale fingerprint is refused as changed", async () => {
    const rec = tree("hotel");
    const r = await rowFor("hotel");
    writeFileSync(join(rec.path, "new.ts"), "x");
    const res = await handlers["worktree:triage-dispose"]({ repoName, tree: "hotel", fingerprint: r.fingerprint, discard: "classified" });
    expect(res).toEqual({ ok: false, error: "changed" });
    expect(existsSync(join(rec.path, "new.ts"))).toBe(true);
  });

  test("discard all is refused on a safe row, allowed on a look row", async () => {
    const safe = tree("india");
    const r1 = await rowFor("india");
    expect((await handlers["worktree:triage-dispose"]({ repoName, tree: "india", fingerprint: r1.fingerprint, discard: "all" })).error).toBe("discard-not-allowed");
    const look = tree("juliet");
    writeFileSync(join(look.path, "evidence.test.ts"), "x");
    const r2 = await rowFor("juliet");
    expect(r2.group).toBe("look");
    expect((await handlers["worktree:triage-dispose"]({ repoName, tree: "juliet", fingerprint: r2.fingerprint, discard: "all" })).ok).toBe(true);
  });

  test("an only-copy row refuses dispose without confirmOnlyCopy", async () => {
    tree("kilo", { push: false });
    const r = await rowFor("kilo");
    expect(r.group).toBe("only-copy");
    expect((await handlers["worktree:triage-dispose"]({ repoName, tree: "kilo", fingerprint: r.fingerprint })).error).toBe("only-copy");
    expect((await handlers["worktree:triage-dispose"]({ repoName, tree: "kilo", fingerprint: r.fingerprint, confirmOnlyCopy: true })).ok).toBe(true);
  });

  test("keep holds until the tree changes, then the row needs a decision again", async () => {
    const rec = tree("lima", { push: false });
    const r = await rowFor("lima");
    await handlers["worktree:keep"]({ repoName, tree: "lima", fingerprint: r.fingerprint });
    expect((await rowFor("lima")).group).toBe("kept");
    writeFileSync(join(rec.path, "more.ts"), "x");
    expect((await rowFor("lima")).group).not.toBe("kept");
  });

  test("push-branch turns an only-copy row safe", async () => {
    tree("mike", { push: false });
    const r = await rowFor("mike");
    const res = await handlers["worktree:push-branch"]({ repoName, tree: "mike", fingerprint: r.fingerprint });
    expect(res.ok).toBe(true);
    expect(res.data.row.group).toBe("safe");
  });

  test("triage-diff shows untracked file content and caps long files", async () => {
    const rec = tree("november");
    writeFileSync(join(rec.path, "long.ts"), Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n"));
    const res = await handlers["worktree:triage-diff"]({ repoName, tree: "november" });
    const f = res.data.files.find((x: any) => x.path === "long.ts");
    expect([f.status, f.truncated]).toEqual(["untracked", true]);
    expect(f.diff.split("\n").length).toBeLessThanOrEqual(401);
  });

  test("triage-remove only removes a broken row", async () => {
    const rec = tree("oscar");
    expect((await handlers["worktree:triage-remove"]({ repoName, tree: "oscar" })).error).toBe("not-broken");
    rmSync(rec.path, { recursive: true, force: true });
    expect((await handlers["worktree:triage-remove"]({ repoName, tree: "oscar" })).ok).toBe(true);
    expect(loadRegistry(repoName).find((t) => t.name === "oscar")).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/worktree-triage-handlers.test.ts`
Expected: FAIL, handlers undefined.

- [ ] **Step 3: Implement the verbs in `worktree-triage.ts`**

Add inside `createWorktreeTriageHandlers` (reuse `disposeDeps` from `handlers/worktree.ts` by exporting it, so the cache scoping matches `worktree:dispose`):

```ts
  const findTree = (repo: string, name: string) => loadRegistry(repo).find((t) => t.name === name && t.kind === "ephemeral") ?? null;
  const resolve = (payload: any): { repo: string; path: string; rec: TreeRecord } | { error: string } => {
    const [hit] = targetRepos(ctx, payload?.repoName);
    if (!hit) return { error: "repo-unknown" };
    const rec = findTree(hit[0], String(payload?.tree ?? ""));
    return rec ? { repo: hit[0], path: hit[1], rec } : { error: "tree-unknown" };
  };
  const freshRow = async (repo: string, path: string, rec: TreeRecord) => triageRow(await collectFacts(repo, path, rec, deps()));

  handlers["worktree:triage-dispose"] = async (payload: any) => {
    const r = resolve(payload);
    if ("error" in r) return { ok: false, error: r.error };
    const out = await withTreeLock(r.rec.path, async () => {
      const facts = await collectFacts(r.repo, r.path, r.rec, deps());
      const row = triageRow(facts);
      if (!sameFingerprint(row.fingerprint, payload.fingerprint)) return { ok: false, error: "changed" };
      const discard = payload.discard ?? "classified";
      if (row.group === "waiting" || row.group === "kept" || row.group === "broken") return { ok: false, error: `not-disposable:${row.group}` };
      if (row.group === "only-copy" && payload.confirmOnlyCopy !== true) return { ok: false, error: "only-copy" };
      if (row.group === "safe" && discard !== "classified") return { ok: false, error: "discard-not-allowed" };
      if (row.group === "look" && discard !== "all") return { ok: false, error: "review-first" };
      if (discard === "classified") {
        for (const f of facts.dirt.discardable) {
          const tracked = (await runGit(r.rec.path, ["ls-files", "--error-unmatch", "--", f])).exitCode === 0;
          await runGit(r.rec.path, tracked ? ["checkout", "HEAD", "--", f] : ["clean", "-fq", "--", f]);
        }
      }
      const force = row.group === "only-copy" || discard === "all";
      const outcome = await disposeTree(disposeDeps(ctx, opts as any, r.repo, r.path), r.rec, { force, auto: false });
      return outcome.disposed ? { ok: true, data: { disposed: true, ...(outcome.trash ? { trash: outcome.trash } : {}) } } : { ok: false, error: outcome.refusal };
    });
    if (out === "busy") return { ok: false, error: "busy" };
    if (out.ok) opts.kick();
    return out;
  };
```

`discard: "all"` on a `look` row forces the dispose because the Review sheet already showed the user every dirty file; `force` there is the explicit override, as it is for **Dispose anyway**. The `safe` path never forces, so the running-run, attended and grace guards still run.

```ts
  handlers["worktree:keep"] = async (payload: any) => {
    const r = resolve(payload);
    if ("error" in r) return { ok: false, error: r.error };
    const row = await freshRow(r.repo, r.path, r.rec);
    if (!sameFingerprint(row.fingerprint, payload.fingerprint)) return { ok: false, error: "changed" };
    patchTree(r.repo, r.rec.path, (t) => { t.kept = { keptAt: new Date().toISOString(), ...row.fingerprint }; });
    return { ok: true, data: { tree: r.rec.name } };
  };

  handlers["worktree:unkeep"] = async (payload: any) => {
    const r = resolve(payload);
    if ("error" in r) return { ok: false, error: r.error };
    patchTree(r.repo, r.rec.path, (t) => { delete t.kept; });
    return { ok: true, data: { tree: r.rec.name } };
  };

  handlers["worktree:push-branch"] = async (payload: any) => {
    const r = resolve(payload);
    if ("error" in r) return { ok: false, error: r.error };
    if (!r.rec.branch) return { ok: false, error: "detached" };
    return withTreeLock(r.rec.path, async () => {
      const row = await freshRow(r.repo, r.path, r.rec);
      if (!sameFingerprint(row.fingerprint, payload.fingerprint)) return { ok: false, error: "changed" };
      if (payload.commitDirty === true && row.dirt.files.length > 0) {
        await runGit(r.rec.path, ["add", "-A", "--", ...row.dirt.files]);
        const msg = typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : `commit ${row.dirt.files.length} leftover file(s) before cleanup`;
        const c = await runGit(r.rec.path, ["commit", "-q", "-m", msg], { timeoutMs: MUTATING_TIMEOUT_MS });
        if (c.exitCode !== 0) return { ok: false, error: `commit-failed:${c.stderr.trim()}` };
      }
      const push = await runGit(r.rec.path, ["push", "-u", "origin", r.rec.branch!], { timeoutMs: MUTATING_TIMEOUT_MS });
      if (push.exitCode !== 0) return { ok: false, error: `push-failed:${push.stderr.trim()}` };
      await runGit(r.rec.path, ["fetch", "-q", "origin", r.rec.branch!]);
      return { ok: true, data: { row: await freshRow(r.repo, r.path, findTree(r.repo, r.rec.name) ?? r.rec) } };
    });
  };

  handlers["worktree:triage-diff"] = async (payload: any) => {
    const r = resolve(payload);
    if ("error" in r) return { ok: false, error: r.error };
    const CAP = 400;
    const tracked = (await runGit(r.rec.path, ["diff", "--name-only", "-z", "HEAD"])).stdout.split("\0").filter(Boolean);
    const untracked = (await runGit(r.rec.path, ["ls-files", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(Boolean);
    const cap = (text: string) => { const lines = text.split("\n"); return { diff: lines.slice(0, CAP).join("\n"), truncated: lines.length > CAP }; };
    const files = [
      ...(await Promise.all(tracked.map(async (p) => ({ path: p, status: "modified" as const, ...cap((await runGit(r.rec.path, ["diff", "HEAD", "--", p])).stdout) })))),
      ...untracked.map((p) => ({ path: p, status: "untracked" as const, ...cap(readFileSync(join(r.rec.path, p), "utf8")) })),
    ];
    return { ok: true, data: { files } };
  };

  handlers["worktree:triage-remove"] = async (payload: any) => {
    const r = resolve(payload);
    if ("error" in r) return { ok: false, error: r.error };
    const row = await freshRow(r.repo, r.path, r.rec);
    if (row.group !== "broken") return { ok: false, error: "not-broken" };
    saveRegistry(r.repo, loadRegistry(r.repo).filter((t) => t.path !== r.rec.path));
    if (existsSync(r.path)) await runGit(r.path, ["worktree", "prune"]);
    return { ok: true, data: { removed: true } };
  };

  handlers["worktree:stop-holders"] = async (payload: any) => {
    const r = resolve(payload);
    if ("error" in r) return { ok: false, error: r.error };
    const siblings = loadRegistry(r.repo).filter((t) => t.path !== r.rec.path).map((t) => t.path);
    return { ok: true, data: await killWorktreeProcesses(r.rec.path, { excludePaths: siblings }) };
  };
```

Declare `const handlers: Record<string, (payload: any) => Promise<any>> = { "worktree:triage": ... }` and return it, so the additions above attach to the same map. Read untracked files with a size guard: skip reading (return `{ diff: "(binary or larger than 1 MB)", truncated: true }`) when `statSync(...).size > 1_000_000` or the file contains a NUL byte in its first 8 KB.

Add each verb's payload/data to `Commands` and `COMMAND_NAMES` in `commands.ts`; rebuild rt-client.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test lib/daemon/__tests__/worktree-triage-handlers.test.ts lib/daemon/__tests__/rt-client-commands.test.ts && bunx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers packages/rt-client/src/commands.ts lib/daemon/__tests__/worktree-triage-handlers.test.ts
git commit -m "daemon: guarded triage actions (dispose, keep, push, diff, remove, stop)"
```

---

### Task 7: Morning summary sweep

**Files:**
- Create: `lib/daemon/triage-summary.ts`
- Modify: `lib/notifier.ts` (`NOTIFICATION_TYPES`), `lib/daemon.ts` (next to the `cd-cache-refresh` `scheduleSweep` call)
- Test: `lib/daemon/__tests__/triage-summary.test.ts`

**Interfaces:**
- Produces:
  - `export const TRIAGE_CATEGORY = "worktree_triage";`
  - `export interface SummaryDeps { now: () => Date; counts: () => Promise<{ needsDecision: number; safe: number }>; notify: (title: string, message: string) => void; loadLastSent: () => string | null; saveLastSent: (day: string) => void }`
  - `export async function maybeSendTriageSummary(deps: SummaryDeps): Promise<boolean>`
  - `export function localDay(d: Date): string` (`YYYY-MM-DD` in local time)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect } from "bun:test";
import { maybeSendTriageSummary, type SummaryDeps } from "../triage-summary.ts";

function deps(at: string, counts = { needsDecision: 4, safe: 2 }, last: string | null = null) {
  const sent: Array<[string, string]> = [];
  let lastSent = last;
  const d: SummaryDeps = {
    now: () => new Date(at),
    counts: async () => counts,
    notify: (t, m) => sent.push([t, m]),
    loadLastSent: () => lastSent,
    saveLastSent: (day) => { lastSent = day; },
  };
  return { d, sent, last: () => lastSent };
}

describe("maybeSendTriageSummary", () => {
  test("nothing before 09:00", async () => {
    const { d, sent } = deps("2026-09-25T08:59:00");
    expect(await maybeSendTriageSummary(d)).toBe(false);
    expect(sent).toEqual([]);
  });
  test("one summary at or after 09:00 with the count and the safe count", async () => {
    const { d, sent } = deps("2026-09-25T09:00:00");
    expect(await maybeSendTriageSummary(d)).toBe(true);
    expect(sent).toEqual([["4 worktrees need a decision", "2 can be cleaned up in one click. Click to review."]]);
  });
  test("never at zero", async () => {
    const { d, sent } = deps("2026-09-25T10:00:00", { needsDecision: 0, safe: 0 });
    expect(await maybeSendTriageSummary(d)).toBe(false);
    expect(sent).toEqual([]);
  });
  test("not twice the same day, including after a restart", async () => {
    const { d, sent } = deps("2026-09-25T11:00:00", undefined, "2026-09-25");
    expect(await maybeSendTriageSummary(d)).toBe(false);
    expect(sent).toEqual([]);
  });
  test("singular and no-safe wording", async () => {
    const { d, sent } = deps("2026-09-25T09:30:00", { needsDecision: 1, safe: 0 });
    await maybeSendTriageSummary(d);
    expect(sent).toEqual([["1 worktree needs a decision", "Click to review."]]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/daemon/__tests__/triage-summary.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`lib/daemon/triage-summary.ts`:

```ts
export const TRIAGE_CATEGORY = "worktree_triage";
const SEND_HOUR = 9;

export interface SummaryDeps {
  now: () => Date;
  counts: () => Promise<{ needsDecision: number; safe: number }>;
  notify: (title: string, message: string) => void;
  loadLastSent: () => string | null;
  saveLastSent: (day: string) => void;
}

export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function maybeSendTriageSummary(deps: SummaryDeps): Promise<boolean> {
  const now = deps.now();
  if (now.getHours() < SEND_HOUR) return false;
  const day = localDay(now);
  if (deps.loadLastSent() === day) return false;
  const { needsDecision, safe } = await deps.counts();
  if (needsDecision <= 0) return false;
  const title = needsDecision === 1 ? "1 worktree needs a decision" : `${needsDecision} worktrees need a decision`;
  const message = safe > 0 ? `${safe} can be cleaned up in one click. Click to review.` : "Click to review.";
  deps.notify(title, message);
  deps.saveLastSent(day);
  return true;
}
```

In `lib/notifier.ts` `NOTIFICATION_TYPES`, add
`{ key: "worktree_triage", label: "Worktree summary", description: "Once a day, when worktrees need a decision" },`.

In `lib/daemon.ts`, next to the `cd-cache-refresh` sweep (it runs after the command router exists, so `handleCommand` is callable):

```ts
        sweepHandles.push(scheduleSweep(
          "worktree-triage-summary",
          () => maybeSendTriageSummary({
            now: () => new Date(),
            counts: async () => {
              const res = await handleCommand("worktree:triage", {});
              return res.ok ? res.data.counts : { needsDecision: 0, safe: 0 };
            },
            notify: (title, message) => notifyEnabled(TRIAGE_CATEGORY, title, message, undefined, undefined, `worktree-triage-${localDay(new Date())}`),
            loadLastSent: () => getKvValue<string | null>("worktree-triage", "last-summary-day", null),
            saveLastSent: (day) => setKvValue("worktree-triage", "last-summary-day", day),
          }),
          { bootDelayMs: 60_000, intervalMs: 15 * 60_000 },
          log,
        ));
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/daemon/__tests__/triage-summary.test.ts && bunx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/triage-summary.ts lib/daemon/__tests__/triage-summary.test.ts lib/notifier.ts lib/daemon.ts
git commit -m "daemon: once-a-day worktree triage summary"
```

---

### Task 8: `rt worktree triage` (CLI, agent-safe)

**Files:**
- Modify: `lib/command-tree-def.ts` (worktree branch, next to `list:` :1305), `commands/worktree.ts` (new `worktreeTriage`), `lib/__tests__/agent-safe.test.ts:15`
- Test: extend `commands/__tests__/worktree.test.ts`

**Interfaces:**
- Consumes: `worktree:triage` (Task 5)
- Produces: `export async function worktreeTriage(args: string[], _ctx: unknown): Promise<void>`; flags `--repo <repo>`, `--json`

- [ ] **Step 1: Write the failing test**

```ts
  test("triage prints one line per row with its group and verdict, and --json passes the payload through", async () => {
    const data = {
      rows: [{ repo: "github.com/acme/app", tree: "olive", path: "/x", branch: "b", mr: { iid: 47, state: "merged", title: "sync button", at: null }, ticket: null,
        push: { kind: "in-main" }, containment: "in-default", dirt: { kind: "junk", files: [".visual/a.png"] }, group: "safe",
        verdict: "Every commit is in main. Only generated files are left.", actions: ["dispose"], fingerprint: { headSha: "h", dirtHash: "d", mrState: "merged" } }],
      banners: [], counts: { needsDecision: 1, safe: 1, waiting: 0, kept: 0 },
    };
    installFakeDaemon({ ok: true, data });
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
    try { await worktreeTriage([], {}); await worktreeTriage(["--json"], {}); } finally { console.log = orig; }
    const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    expect(plain.some((l) => l.includes("olive") && l.includes("safe") && l.includes("Every commit is in main."))).toBe(true);
    expect(JSON.parse(plain[plain.length - 1]!).counts.needsDecision).toBe(1);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test commands/__tests__/worktree.test.ts -t triage`
Expected: FAIL, `worktreeTriage` not exported.

- [ ] **Step 3: Implement**

In `commands/worktree.ts`, reusing `parseListArgs`, `resolveRepoArg`, `daemonQuery`, `requireQueryResult`, `repoLabel` and the colour helpers the file already imports:

```ts
export async function worktreeTriage(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseListArgs(args);
  const repoName = parsed.repoName ? await resolveRepoArg(parsed.repoName, (m) => failText(parsed.json, m)) : undefined;
  const res = await daemonQuery("worktree:triage", repoName ? { repoName } : undefined);
  const ok = requireQueryResult(parsed.json, res);
  if (parsed.json) { console.log(JSON.stringify(ok.data, null, 2)); return; }
  const { rows, counts } = ok.data as { rows: Array<Record<string, any>>; counts: { needsDecision: number } };
  console.log(`\n  ${bold}${counts.needsDecision} worktree${counts.needsDecision === 1 ? "" : "s"} need a decision${reset}\n`);
  for (const r of rows) {
    const mr = r.mr ? `  ${dim}!${r.mr.iid} ${r.mr.state}${reset}` : "";
    console.log(`  ${bold}${repoLabel(r.repo)}/${r.tree}${reset}  ${dim}${r.group}${reset}${mr}  ${r.verdict}`);
  }
  console.log("");
}
```

In `lib/command-tree-def.ts`, add under the worktree branch next to `list`:

```ts
      triage: {
        description: "Stuck worktrees: why each one stayed, and what's safe to do",
        module: "./commands/worktree.ts",
        fn: "worktreeTriage",
        agentSafe: true,
        args: [{ name: "--repo", type: "text", description: "Narrow to this registered repo" }, { name: "--json", type: "boolean", description: "Print the raw result as JSON" }],
      },
```

Match the arg/flag object shape to the existing `list` node exactly (copy it and rename). Add `"worktree triage"` to the explicit list in `lib/__tests__/agent-safe.test.ts`. `commands/worktree.ts` is already in `lib/module-registry.ts`, so no registry change.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test commands/__tests__/worktree.test.ts lib/__tests__/agent-safe.test.ts lib/__tests__/picker-conformance.test.ts && bun run picker:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/worktree.ts lib/command-tree-def.ts lib/__tests__/agent-safe.test.ts commands/__tests__/worktree.test.ts
git commit -m "cli: rt worktree triage"
```

---

### Task 9: Swift core models, grouping and the notification route

**Files:**
- Create: `rt-tray/Sources-core/Worktree/Triage.swift`, `rt-tray/Tests/MattstackCoreChecks/TriageChecks.swift`
- Modify: `rt-tray/Sources-core/Launch/NotificationClick.swift`, `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift:3`

**Interfaces:**
- Consumes: the `worktree:triage` JSON shape (Task 5)
- Produces (public, in `MattstackCore`):
  - `public struct TriagePayload: Decodable, Sendable { public let ok: Bool; public let data: TriageData?; public let error: String? }`
  - `public struct TriageData: Decodable, Sendable { public let rows: [TriageRow]; public let banners: [TriageBanner]; public let counts: TriageCounts }`
  - `public struct TriageRow: Decodable, Sendable, Identifiable, Equatable` with `id` = `"\(repo)#\(tree)"`, fields mirroring Task 4 (`group: String`, `actions: [String]`, nested `MR`, `Ticket`, `Push`, `Dirt`, `Hold`, `Fingerprint` structs; `Fingerprint` is also `Encodable` so it can be sent back)
  - `public struct TriageCounts: Decodable, Sendable, Equatable { needsDecision, safe, waiting, kept: Int }`
  - `public struct TriageBanner: Decodable, Sendable { public let repo: String; public let reason: String; public let forge: String? }`
  - `public enum TriageSection: String, CaseIterable, Sendable { case needsDecision, waiting, broken, kept }` with `public static func sections(_ rows: [TriageRow]) -> [(TriageSection, [TriageRow])]` (empty sections dropped; needsDecision orders safe, look, only-copy)
  - `public enum TriageTone: String, Sendable { case safe, look, risk, held, busy, broken, kept }` and `public static func tone(for row: TriageRow) -> TriageTone`
  - `public enum MRTone: String, Sendable { case merged, closed, open }`
  - `public static func badgeTitle(_ counts: TriageCounts?) -> String` on `enum TriageMenu` (returns `"Worktrees…"` or `"Worktrees…"` plus nothing; the badge number itself is `counts.needsDecision > 0 ? "\(n)" : nil`)
  - `NotificationClick.worktreeTriageCategory = "worktree_triage"` and `Route.showWorktreePanel` (with `suppressesActivationShow == false`)

- [ ] **Step 1: Write the failing checks**

`rt-tray/Tests/MattstackCoreChecks/TriageChecks.swift`:

```swift
import Foundation
import MattstackCore

private let json = """
{"ok":true,"data":{"counts":{"needsDecision":3,"safe":1,"waiting":1,"kept":1},"banners":[],
"rows":[
 {"repo":"github.com/m4ttstack/rt","tree":"neville","path":"/p/n","branch":"spike","mr":{"iid":342,"state":"closed","title":"Draft: spike","at":null},"ticket":{"identifier":"RT-199","title":"t","stateName":"Canceled"},"push":{"kind":"unpushed","ahead":19},"containment":"none","dirt":{"kind":"none","files":[]},"group":"only-copy","verdict":"Only copy of this work. Push the branch to keep it, or dispose to drop it.","actions":["push-branch","keep","dispose"],"fingerprint":{"headSha":"h","dirtHash":"d","mrState":"closed"}},
 {"repo":"github.com/m4ttstack/app-kit","tree":"olive","path":"/p/o","branch":"b","mr":{"iid":47,"state":"merged","title":"sync","at":null},"ticket":null,"push":{"kind":"in-main"},"containment":"in-default","dirt":{"kind":"junk","files":[".visual/a.png"]},"group":"safe","verdict":"Every commit is in main.","actions":["dispose"],"fingerprint":{"headSha":"h","dirtHash":"d","mrState":"merged"}},
 {"repo":"github.com/m4ttstack/rt","tree":"smaug","path":"/p/s","branch":"b","mr":null,"ticket":null,"push":{"kind":"pushed"},"containment":"on-remote","dirt":{"kind":"none","files":[]},"group":"waiting","verdict":"Waiting: x.","actions":["stop-process"],"hold":{"kind":"process","detail":"x"},"fingerprint":{"headSha":"h","dirtHash":"d","mrState":null}},
 {"repo":"github.com/m4ttstack/rt","tree":"daisy","path":"/p/d","branch":null,"mr":null,"ticket":null,"push":{"kind":"unpushed","ahead":0},"containment":"none","dirt":{"kind":"none","files":[]},"group":"broken","verdict":"Gone.","actions":["remove"],"fingerprint":{"headSha":"","dirtHash":"d","mrState":null}},
 {"repo":"github.com/m4ttstack/rt","tree":"gollum","path":"/p/g","branch":"r","mr":{"iid":301,"state":"closed","title":"spike","at":null},"ticket":null,"push":{"kind":"unpushed","ahead":4},"containment":"none","dirt":{"kind":"none","files":[]},"group":"kept","verdict":"Kept.","actions":["unkeep"],"keptAt":"2026-09-24T00:00:00Z","fingerprint":{"headSha":"h","dirtHash":"d","mrState":"closed"}}
]}}
"""

let triageChecks: [Check] = [
    Check("triage payload decodes every group") { c in
        let p = try JSONDecoder().decode(TriagePayload.self, from: Data(json.utf8))
        c.expectEqual(p.data?.rows.count, 5)
        c.expectEqual(p.data?.counts.needsDecision, 3)
        c.expectEqual(p.data?.rows.first?.push.ahead, 19)
    },
    Check("sections order needs-decision safe first, then waiting, broken, kept; empty ones dropped") { c in
        let rows = try JSONDecoder().decode(TriagePayload.self, from: Data(json.utf8)).data!.rows
        let s = TriageSection.sections(rows)
        c.expectEqual(s.map { $0.0 }, [.needsDecision, .waiting, .broken, .kept])
        c.expectEqual(s[0].1.map { $0.tree }, ["olive", "neville"])
        c.expectEqual(TriageSection.sections([]).count, 0)
    },
    Check("tones follow the group; kept is neutral") { c in
        let rows = try JSONDecoder().decode(TriagePayload.self, from: Data(json.utf8)).data!.rows
        c.expectEqual(rows.map { TriageTone.tone(for: $0) }, [.risk, .safe, .held, .broken, .kept])
    },
    Check("the menu badge shows needsDecision only when above zero") { c in
        c.expectEqual(TriageMenu.badge(TriageCounts(needsDecision: 4, safe: 2, waiting: 1, kept: 0)), "4")
        c.expectEqual(TriageMenu.badge(TriageCounts(needsDecision: 0, safe: 0, waiting: 3, kept: 1)), nil)
        c.expectEqual(TriageMenu.badge(nil), nil)
    },
    Check("a worktree_triage banner click opens the worktree panel") { c in
        c.expectEqual(NotificationClick.bannerRoute(category: NotificationClick.worktreeTriageCategory, url: nil, paneId: nil), .showWorktreePanel)
        c.expectEqual(NotificationClick.Route.showWorktreePanel.suppressesActivationShow, false)
    },
]
```

Append `+ triageChecks` to `allChecks` in `AllChecks.swift`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd rt-tray && swift build 2>&1 | tail -5`
Expected: build fails, `cannot find 'TriagePayload' in scope`.

- [ ] **Step 3: Implement `Triage.swift` and the route**

```swift
import Foundation

public struct TriageFingerprint: Codable, Sendable, Equatable {
    public let headSha: String
    public let dirtHash: String
    public let mrState: String?
}

public struct TriageRow: Decodable, Sendable, Identifiable, Equatable {
    public struct MR: Decodable, Sendable, Equatable { public let iid: Int; public let state: String; public let title: String; public let at: String? }
    public struct Ticket: Decodable, Sendable, Equatable { public let identifier: String; public let title: String; public let stateName: String? }
    public struct Push: Decodable, Sendable, Equatable { public let kind: String; public let ahead: Int? }
    public struct Dirt: Decodable, Sendable, Equatable { public let kind: String; public let files: [String] }
    public struct Hold: Decodable, Sendable, Equatable { public let kind: String; public let detail: String }

    public let repo: String
    public let tree: String
    public let path: String
    public let branch: String?
    public let mr: MR?
    public let ticket: Ticket?
    public let push: Push
    public let containment: String
    public let dirt: Dirt
    public let group: String
    public let verdict: String
    public let actions: [String]
    public let hold: Hold?
    public let keptAt: String?
    public let fingerprint: TriageFingerprint

    public var id: String { "\(repo)#\(tree)" }
    public var repoLabel: String { repo.split(separator: "/").last.map(String.init) ?? repo }
}

public struct TriageCounts: Decodable, Sendable, Equatable {
    public let needsDecision: Int
    public let safe: Int
    public let waiting: Int
    public let kept: Int
    public init(needsDecision: Int, safe: Int, waiting: Int, kept: Int) {
        self.needsDecision = needsDecision; self.safe = safe; self.waiting = waiting; self.kept = kept
    }
}

public struct TriageBanner: Decodable, Sendable {
    public let repo: String
    public let reason: String
    public let forge: String?
}

public struct TriageData: Decodable, Sendable {
    public let rows: [TriageRow]
    public let banners: [TriageBanner]
    public let counts: TriageCounts
}

public struct TriagePayload: Decodable, Sendable {
    public let ok: Bool
    public let data: TriageData?
    public let error: String?
}

public enum TriageSection: String, CaseIterable, Sendable {
    case needsDecision, waiting, broken, kept

    private static let decisionOrder = ["safe", "look", "only-copy"]

    public static func sections(_ rows: [TriageRow]) -> [(TriageSection, [TriageRow])] {
        let decision = rows.filter { decisionOrder.contains($0.group) }
            .sorted { decisionOrder.firstIndex(of: $0.group)! < decisionOrder.firstIndex(of: $1.group)! }
        let all: [(TriageSection, [TriageRow])] = [
            (.needsDecision, decision),
            (.waiting, rows.filter { $0.group == "waiting" }),
            (.broken, rows.filter { $0.group == "broken" }),
            (.kept, rows.filter { $0.group == "kept" }),
        ]
        return all.filter { !$0.1.isEmpty }
    }
}

public enum TriageTone: String, Sendable {
    case safe, look, risk, held, busy, broken, kept

    public static func tone(for row: TriageRow) -> TriageTone {
        switch row.group {
        case "safe": return .safe
        case "look": return .look
        case "only-copy": return .risk
        case "waiting": return row.hold?.kind == "orphan-stopping" ? .busy : .held
        case "broken": return .broken
        default: return .kept
        }
    }
}

public enum MRTone: String, Sendable {
    case merged, closed, open
    public static func of(_ state: String) -> MRTone { state == "merged" ? .merged : state == "closed" ? .closed : .open }
}

public enum TriageMenu {
    public static func badge(_ counts: TriageCounts?) -> String? {
        guard let n = counts?.needsDecision, n > 0 else { return nil }
        return "\(n)"
    }
}
```

The check file constructs `TriageCounts(...)`, hence the public init. Note the stable sort: `sorted` is not guaranteed stable in Swift, so if two rows share a group their order can swap; use `enumerated()` with the original index as a tiebreak:

```swift
        let decision = rows.enumerated()
            .filter { decisionOrder.contains($0.element.group) }
            .sorted { (decisionOrder.firstIndex(of: $0.element.group)!, $0.offset) < (decisionOrder.firstIndex(of: $1.element.group)!, $1.offset) }
            .map { $0.element }
```

In `NotificationClick.swift`: add `public static let worktreeTriageCategory = "worktree_triage"`, `case showWorktreePanel` to `Route` (and to the `suppressesActivationShow` switch's `return false` group), and `if category == worktreeTriageCategory { return .showWorktreePanel }` in `bannerRoute` next to the `readyHeldCategory` line.

- [ ] **Step 4: Run to verify it passes**

Run: `cd rt-tray && swift build && swift run mattstack-checks triage && swift run mattstack-checks`
Expected: all checks pass (the second run confirms no other check broke on the new `Route` case).

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Worktree/Triage.swift rt-tray/Sources-core/Launch/NotificationClick.swift rt-tray/Tests/MattstackCoreChecks
git commit -m "tray core: triage models, sections, tones, worktree_triage route"
```

---

### Task 10: Tray client, controller, menu item and window

**Files:**
- Modify: `rt-tray/Sources/DaemonClient.swift` (POST path next to `querySocket` :119), `rt-tray/Sources/AppDelegate.swift` (menu :742, window next to `detachProcessPanel` :1296, observers :127-138), `rt-tray/Sources/AccessibilityIDs.swift` (tray block :148-160), `rt-tray/Sources/NotificationManager.swift` (`Notification.Name` list :525, `follow` :400, categories :110)
- Create: `rt-tray/Sources/WorktreePanelController.swift`, a placeholder `rt-tray/Sources/WorktreePanelView.swift` holding a `List` of verdict strings (Task 11 replaces its body)

**Interfaces:**
- Consumes: Task 9 models; daemon verbs from Tasks 5 and 6
- Produces:
  - `DaemonClient.command<T: Decodable>(_ command: String, payload: [String: Any]) async -> T?` (POST over the socket; nil on failure, like every other method)
  - `DaemonClient.queryTriage() async -> TriagePayload?`
  - `final class WorktreePanelController: ObservableObject` with `@Published rows: [TriageRow]`, `@Published counts: TriageCounts?`, `@Published banners: [TriageBanner]`, `@Published status: PanelStatus?`, `@Published busy: Set<String>` (row ids in flight), `func startPolling()`, `func stopPolling()`, `func refresh()`, `func dispose(_ row: TriageRow, discard: String = "classified", confirmOnlyCopy: Bool = false)`, `func keep(_ row: TriageRow)`, `func unkeep(_ row: TriageRow)`, `func pushBranch(_ row: TriageRow, commitDirty: Bool = false)`, `func stopHolders(_ row: TriageRow)`, `func remove(_ row: TriageRow)`, `func cleanUpSafe()`, `func diff(_ row: TriageRow) async -> [TriageDiffFile]`
  - `struct TriageDiffFile: Decodable, Identifiable { let path: String; let status: String; let diff: String; let truncated: Bool; var id: String { path } }`
  - `AXID.trayWorktrees = "tray.worktrees"`, `Notification.Name.showWorktreePanel`
  - `AppDelegate.showWorktreePanel()`

- [ ] **Step 1: Add the POST path and triage calls to `DaemonClient.swift`**

```swift
    /// POST with a JSON body. The socket server reads `payload` from the body
    /// on POST; GET-only `querySocket` can't carry one.
    func command<T: Decodable>(_ command: String, payload: [String: Any]) async -> T? {
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        return await postSocket(command, body: body)
    }

    func queryTriage() async -> TriagePayload? { await querySocket("worktree:triage") }
```

Implement `postSocket` by copying `querySocket` (:119) and changing the request line to `"POST /\(command) HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"` followed by the body bytes; keep its timeout, response parsing and `TrayLog.error` decode logging identical. Use a 30 s timeout for `postSocket` (dispose and push can take seconds; `querySocket`'s 2 s would time out a push).

- [ ] **Step 2: Implement `WorktreePanelController.swift`**

```swift
import AppKit
import Combine
import MattstackCore

struct TriageDiffFile: Decodable, Identifiable {
    let path: String
    let status: String
    let diff: String
    let truncated: Bool
    var id: String { path }
}

private struct ActionReply: Decodable { let ok: Bool; let error: String? }
private struct DiffReply: Decodable { struct D: Decodable { let files: [TriageDiffFile] }; let ok: Bool; let data: D? }

final class WorktreePanelController: ObservableObject {
    @Published var rows: [TriageRow] = []
    @Published var counts: TriageCounts?
    @Published var banners: [TriageBanner] = []
    @Published var status: PanelStatus?
    @Published var busy: Set<String> = []
    @Published var isLoading = true

    private let client = DaemonClient()
    private var timer: Timer?
    private var statusGeneration = 0

    func startPolling() {
        refresh()
        let t = Timer(timeInterval: 10, repeats: true) { [weak self] _ in self?.refresh() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stopPolling() { timer?.invalidate(); timer = nil }

    func refresh() {
        Task {
            let p = await client.queryTriage()
            await MainActor.run {
                isLoading = false
                guard let data = p?.data else { setStatus("Couldn't reach the daemon", isError: true); return }
                rows = data.rows; counts = data.counts; banners = data.banners
            }
        }
    }

    private func run(_ row: TriageRow, _ verb: String, _ payload: [String: Any], done: String) {
        busy.insert(row.id)
        var body = payload
        body["repoName"] = row.repo
        body["tree"] = row.tree
        Task {
            let r: ActionReply? = await client.command(verb, payload: body)
            await MainActor.run {
                busy.remove(row.id)
                if r?.ok == true { setStatus("\(row.tree): \(done)", isError: false) }
                else { setStatus("\(row.tree): \(Self.explain(r?.error))", isError: true) }
                refresh()
            }
        }
    }

    private var fp: (TriageRow) -> [String: Any] = { row in
        ["headSha": row.fingerprint.headSha, "dirtHash": row.fingerprint.dirtHash, "mrState": row.fingerprint.mrState as Any]
    }

    func dispose(_ row: TriageRow, discard: String = "classified", confirmOnlyCopy: Bool = false) {
        run(row, "worktree:triage-dispose", ["fingerprint": fp(row), "discard": discard, "confirmOnlyCopy": confirmOnlyCopy], done: "disposed (restorable for 14 days)")
    }
    func keep(_ row: TriageRow) { run(row, "worktree:keep", ["fingerprint": fp(row)], done: "kept") }
    func unkeep(_ row: TriageRow) { run(row, "worktree:unkeep", [:], done: "no longer kept") }
    func pushBranch(_ row: TriageRow, commitDirty: Bool = false) {
        run(row, "worktree:push-branch", ["fingerprint": fp(row), "commitDirty": commitDirty], done: "pushed")
    }
    func stopHolders(_ row: TriageRow) { run(row, "worktree:stop-holders", [:], done: "processes stopped") }
    func remove(_ row: TriageRow) { run(row, "worktree:triage-remove", [:], done: "removed") }

    func cleanUpSafe() {
        for row in rows where row.group == "safe" { dispose(row) }
    }

    func diff(_ row: TriageRow) async -> [TriageDiffFile] {
        let r: DiffReply? = await client.command("worktree:triage-diff", payload: ["repoName": row.repo, "tree": row.tree])
        return r?.data?.files ?? []
    }

    static func explain(_ error: String?) -> String {
        switch error {
        case "changed": return "it changed since this list loaded. Refreshed."
        case "only-copy": return "this is the only copy. Push it first, or use Dispose anyway."
        case "review-first": return "review the uncommitted files first."
        case .some(let e): return e
        case .none: return "couldn't reach the daemon."
        }
    }

    func setStatus(_ text: String, isError: Bool) {
        statusGeneration += 1
        let gen = statusGeneration
        status = PanelStatus(text: text, isError: isError)
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            if self?.statusGeneration == gen { self?.status = nil }
        }
    }
}
```

`PanelStatus` is the existing struct from `ProcessPanelController.swift:6`; reuse it, don't redeclare it.

- [ ] **Step 3: Wire the menu item, window and click route**

`AccessibilityIDs.swift`: `static let trayWorktrees = "tray.worktrees"`.

`NotificationManager.swift`:
- `static let showWorktreePanel = Notification.Name("showWorktreePanel")` next to `.showProcessPanel` (:525).
- In `follow(_:)` (:400): `case .showWorktreePanel: NotificationCenter.default.post(name: .showWorktreePanel, object: nil)`.
- Register a `UNNotificationCategory(identifier: NotificationClick.worktreeTriageCategory, actions: [], intentIdentifiers: [])` in the array at :110.

`AppDelegate.swift`:
- Stored property next to `processWindow` (:30): `private var worktreeWindow: NSWindow?` and `private var triageCounts: TriageCounts?`.
- Observer next to the process ones (:127-138): `NotificationCenter.default.addObserver(forName: .showWorktreePanel, object: nil, queue: .main) { [weak self] _ in self?.showWorktreePanel() }`.
- Menu (after the `Processes…` item at :742):

```swift
        let worktreesTitle = TriageMenu.badge(triageCounts).map { "Worktrees…  \($0)" } ?? "Worktrees…"
        menu.addItem(ActionMenuItem(worktreesTitle, axid: AXID.trayWorktrees) { [weak self] in
            self?.showWorktreePanel()
        })
```

and refresh the count whenever the menu is about to open (the same place `rebuildTrayMenu` is driven from; `menuNeedsUpdate` or its caller): `Task { let p = await daemonClient.queryTriage(); await MainActor.run { self.triageCounts = p?.data?.counts } }`. The count shown is the one from the previous open when the query hasn't returned yet; that lag is acceptable and avoids blocking the menu.

- Window, modelled on `detachProcessPanel` (:1296):

```swift
    @MainActor
    func showWorktreePanel() {
        if let w = worktreeWindow { w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 780, height: 720),
                         styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        w.title = "Worktrees"
        w.contentViewController = NSHostingController(rootView: WorktreePanelView())
        w.setContentSize(NSSize(width: 780, height: 720))
        w.center()
        w.setFrameAutosaveName("rt-worktree-panel")
        w.isReleasedWhenClosed = false
        worktreeWindow = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
```

Placeholder `WorktreePanelView.swift` (replaced in Task 11):

```swift
import SwiftUI
import MattstackCore

struct WorktreePanelView: View {
    @StateObject private var controller = WorktreePanelController()
    var body: some View {
        List(controller.rows) { row in Text("\(row.tree): \(row.verdict)") }
            .onAppear { controller.startPolling() }
            .onDisappear { controller.stopPolling() }
    }
}
```

- [ ] **Step 4: Build**

Run: `cd rt-tray && swift build 2>&1 | tail -5 && swift run mattstack-checks`
Expected: builds, all checks pass.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources
git commit -m "tray: Worktrees menu item with count, panel window, triage client"
```

---

### Task 11: Panel rows, Review sheet, visual check

**Files:**
- Modify: `rt-tray/Sources/WorktreePanelView.swift` (replace the placeholder)
- Create: `rt-tray/Sources/WorktreeReviewSheet.swift`

**Interfaces:**
- Consumes: `WorktreePanelController` (Task 10), `TriageSection`, `TriageTone`, `MRTone` (Task 9)
- Produces: the panel as drawn on `docs/design/worktrees/panel-*.png`, `state-catalog-*.png`, `review-sheet-*.png`

- [ ] **Step 1: Implement the panel**

Match the boards by eye. Colours come from semantic system colours so both appearances work (no hex literals): verdict icon tints `.green` (safe), `.orange` (look), `.red` (risk), `.secondary` (held, broken, kept), `.accentColor` (busy); MR chip `.blue` merged, `.red` closed, `.green` open; every other chip `.secondary` text on `Color.secondary.opacity(0.12)`; the `unpushed` chip's icon `.red`. Kept rows: every chip and the icon `.secondary`.

```swift
import SwiftUI
import MattstackCore

struct WorktreePanelView: View {
    @StateObject private var controller = WorktreePanelController()
    @State private var reviewing: TriageRow?
    @State private var keptOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(controller.banners, id: \.repo) { BannerView(banner: $0) }
                    ForEach(TriageSection.sections(controller.rows), id: \.0) { section, rows in
                        if section == .kept {
                            DisclosureGroup(isExpanded: $keptOpen) {
                                ForEach(rows) { row(for: $0) }
                            } label: { SectionLabel("Kept (\(rows.count))") }
                        } else {
                            SectionLabel(Self.title(section))
                            ForEach(rows) { row(for: $0) }
                        }
                    }
                    if !controller.isLoading && controller.rows.isEmpty {
                        Text("Nothing stuck. Every merged worktree was cleaned up.").foregroundStyle(.secondary).padding(24)
                    }
                }.padding(12)
            }
            footer
        }
        .frame(minWidth: 640, minHeight: 420)
        .onAppear { controller.startPolling() }
        .onDisappear { controller.stopPolling() }
        .sheet(item: $reviewing) { WorktreeReviewSheet(row: $0, controller: controller) }
    }

    private var header: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                Text(headline).font(.title2.weight(.semibold))
                Text("Their MR merged or closed, but something kept them from being cleaned up.").foregroundStyle(.secondary)
            }
            Spacer()
            if let safe = controller.counts?.safe, safe > 0 {
                Button { controller.cleanUpSafe() } label: { Label("Clean up \(safe) safe", systemImage: "sparkles") }
                    .buttonStyle(.borderedProminent)
            }
        }.padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 12)
    }

    private var headline: String {
        let n = controller.counts?.needsDecision ?? 0
        return n == 1 ? "1 worktree needs a decision" : "\(n) worktrees need a decision"
    }

    private var footer: some View {
        HStack(spacing: 6) {
            if let s = controller.status {
                Text(s.text).foregroundStyle(s.isError ? .red : .secondary)
            } else {
                Image(systemName: "trash").foregroundStyle(.tertiary)
                Text("Disposed worktrees stay restorable for 14 days.").foregroundStyle(.tertiary)
            }
            Spacer()
        }.font(.caption).padding(.horizontal, 20).padding(.vertical, 12)
    }

    private static func title(_ s: TriageSection) -> String {
        switch s { case .needsDecision: "Needs a decision"; case .waiting: "Waiting"; case .broken: "Broken"; case .kept: "Kept" }
    }

    @ViewBuilder private func row(for r: TriageRow) -> some View {
        TriageRowView(row: r, busy: controller.busy.contains(r.id)) { action in
            switch action {
            case "dispose": r.group == "only-copy" ? controller.dispose(r, discard: "all", confirmOnlyCopy: true) : controller.dispose(r)
            case "review": reviewing = r
            case "push-branch": controller.pushBranch(r)
            case "keep": controller.keep(r)
            case "unkeep": controller.unkeep(r)
            case "stop-process": controller.stopHolders(r)
            case "remove": controller.remove(r)
            case "open-finder": NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: r.path)])
            case "open-terminal": NSWorkspace.shared.open([URL(fileURLWithPath: r.path)], withApplicationAt: URL(fileURLWithPath: "/System/Applications/Utilities/Terminal.app"), configuration: .init())
            case "copy-path": NSPasteboard.general.clearContents(); NSPasteboard.general.setString(r.path, forType: .string)
            default: break
            }
        }
    }
}
```

`TriageRowView` (same file): an `HStack` of the 30 pt tinted circle icon (`checkmark.circle` safe, `doc.badge.ellipsis` look, `exclamationmark.triangle` risk, `lock` held, `arrow.triangle.2.circlepath` busy, `link.badge.plus` broken, `bookmark` kept), a `VStack(alignment: .leading, spacing: 3)` with the MR title (`.headline`; fall back to the branch, then the tree name, when there is no MR), a line with the tree name (`.subheadline.weight(.medium)`, secondary) and `"\(repoLabel) · \(branch)"` (monospaced, secondary), a chip row (MR chip `"!\(iid)"` for GitLab identities, `"#\(iid)"` for GitHub, plus the state and `at` date; push chip text from `push.kind` as `pushed`, `in main`, `remote deleted`, `\(ahead) unpushed`; ticket chip `"\(identifier) · \(stateName)"`), and the verdict (`.callout`, secondary); then the primary button for `actions[0]` (prominent only for `push-branch`) and a `Menu` with `…` holding Keep/Un-keep, **Dispose anyway** (role `.destructive`, only for `only-copy` rows), Open in Finder, Open in terminal, Copy path. A `busy` row shows a `ProgressView` in place of the button. Button titles by action: `dispose` Dispose, `review` Review, `push-branch` Push branch, `unkeep` Un-keep, `stop-process` Stop process, `open-herd` Open herd, `open-run` Open run, `remove` Remove.

`open-herd` and `open-run` post the existing notifications the tray already uses for those surfaces if they exist (`grep -n "Notification.Name(" rt-tray/Sources/NotificationManager.swift`); if there is no herd or run surface in the tray, open the console URL for the run/herd via `NSWorkspace.shared.open` using the same base URL the tray's "Open mattstack" window uses. Do not invent a new surface.

- [ ] **Step 2: Implement `WorktreeReviewSheet.swift`**

```swift
import SwiftUI
import MattstackCore

struct WorktreeReviewSheet: View {
    let row: TriageRow
    @ObservedObject var controller: WorktreePanelController
    @Environment(\.dismiss) private var dismiss
    @State private var files: [TriageDiffFile] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Review uncommitted changes").font(.headline)
                Text("\(row.tree) · \(row.repoLabel) · \(row.branch ?? ""). The PR merged; these files never made it into a commit.")
                    .foregroundStyle(.secondary)
            }.padding(20)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(files) { f in
                        HStack {
                            Image(systemName: f.status == "untracked" ? "doc.badge.plus" : "doc.text")
                            Text(f.path).font(.system(.caption, design: .monospaced))
                            Spacer()
                            Text(f.status).foregroundStyle(.tertiary).font(.caption)
                        }.padding(.horizontal, 20).padding(.vertical, 8).background(Color.secondary.opacity(0.08))
                        DiffBody(text: f.diff, untracked: f.status == "untracked")
                        if f.truncated { Text("More lines not shown").font(.caption).foregroundStyle(.tertiary).padding(.horizontal, 20).padding(.vertical, 6) }
                    }
                }
            }.frame(minHeight: 280)
            Divider()
            HStack {
                Text("Discarded files stay in the trash for 14 days.").font(.caption).foregroundStyle(.tertiary)
                Spacer()
                Button("Keep") { controller.keep(row); dismiss() }
                Button("Commit and push") { controller.pushBranch(row, commitDirty: true); dismiss() }
                Button("Discard and dispose") { controller.dispose(row, discard: "all"); dismiss() }.buttonStyle(.borderedProminent)
            }.padding(16)
        }
        .frame(width: 680)
        .task { files = await controller.diff(row) }
    }
}
```

`DiffBody` (same file): renders each line in a monospaced `.caption` row on `Color.secondary.opacity(0.06)`, with a gutter of line number (tertiary) and a marker column. Untracked files mark every line `+`; tracked diffs use the line's own `+`/`-`/space prefix. Only the marker is coloured (`+` green, `-` red); the line background stays neutral.

- [ ] **Step 3: Build and run the checks**

Run: `cd rt-tray && swift build 2>&1 | tail -5 && swift run mattstack-checks`
Expected: builds clean, checks pass.

- [ ] **Step 4: Visual validation in both appearances**

Build a dev app in a scratch tree per `AGENTS.md` ("Tray and shim changes need a dev app rebuild": `scripts/fetch-deps.sh arm64`, then `rt-tray/build.sh dev`, never in the shared checkout's `rt-tray/`). Hand the swap of `/Applications/mattstack-dev.app` to Matt (GUI launches from a worker are blocked; see the `rt:build-dev-app` skill). With the dev app running on a machine that has stuck trees (or with fixture rows from `worktree:triage` on a seeded HOME):
- open **Worktrees…** from the tray, screenshot in Light and in Dark (`defaults write -g AppleInterfaceStyle Dark` / delete, or System Settings), and screenshot the Review sheet on a `look` row;
- compare each against `docs/design/worktrees/panel-*.png`, `state-catalog-*.png` and `review-sheet-*.png` by eye;
- write down plainly what looks wrong (spacing, colour budget broken, clipped text, chip wrapping) and fix it before continuing. A passing build is not this step's evidence; the screenshots are.

- [ ] **Step 5: Full suites, then commit**

Run: `bun run test:all > $TMPDIR/triage-all.txt 2>&1; tail -20 $TMPDIR/triage-all.txt`
Expected: no new failures (compare any failure against a clean `main` run before calling it pre-existing).

```bash
git add rt-tray/Sources/WorktreePanelView.swift rt-tray/Sources/WorktreeReviewSheet.swift
git commit -m "tray: Worktrees panel rows, chips, sections and Review sheet"
```

---

## Self-review notes

- Spec coverage: stuck-tree set (Task 5 `isStuck`), containment incl. RT-271 (Task 1), dirt classes and junk key (Task 2), groups/verdicts/actions/counts (Task 4), fingerprint and keep (Tasks 3, 6), all action verbs (Task 6), summary sweep (Task 7), CLI (Task 8), tray menu/count/panel/sheet/notification route (Tasks 9 to 11), visual check both schemes (Task 11).
- Review Focus pins: stale fingerprint (Task 6 "changed"), spaced path (Task 2 "my shot.png", Task 6 "a b.png"), dependency-range lockfile diff (Task 2), unfetchable MR sha (Task 1), same-day restart (Task 7).
