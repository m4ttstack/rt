# glitter Stash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt glitter` stashes the way GitHub Desktop does: one tagged stash per branch, Stash All Changes, a Stashed Changes view with Restore and Discard, and Desktop's leave-or-bring question when switching branches with changes.

**Architecture:** git-core gains a verbatim port of GitHub Desktop's `stash.ts` (`desktop-stash.ts`), addressed by stash sha. `lib/mission/stash.ts` ports Desktop's app-store sequencing (create-then-drop, leave, bring) and a small `StashStore` for the current branch's entry, its files, and whether the stash view is showing. The driver wires new intents and a one-shot `switchPrompt`; while the stash view shows, the existing `diff` field carries the stash file's read-only diff. The Go view lifts History's right pane into a shared committed-pane renderer, paints the stash view through it, and builds every dialog as a `picker.Menu` question.

**Tech Stack:** Go + Bubble Tea v2 + lipgloss v2 (rt-ui), Bun + TypeScript (driver, git-core), termwright (pty gate).

**Spec:** `docs/superpowers/specs/2026-09-23-glitter-stash-design.md`

**GHD source of truth:** `~/Documents/GitHub/github-desktop` at commit `9dfe6e60`. Paths written `app/src/...` are relative to that clone. Read the named function before porting it.

## Global Constraints

- The rt repo is PUBLIC. Never write a Linear ticket id (the letters R, T, a hyphen, then digits) or an employer name into source, tests, comments, fixtures, or commit messages. Run `bash scripts/repo-purity.sh` before every commit.
- Never use em dashes or en dashes anywhere (code, comments, docs, commit messages). Use "..." or rephrase. Labels use the single-character ellipsis `…` exactly where GitHub Desktop does.
- Comments state only constraints the code cannot show (parity anchors, ordering traps, invariants). No narration, no reviewer-facing justification, no decision history, no task numbers.
- Every color is a `theme.go` token (`ui/internal/theme/theme.go`). Never an inline hex or `lipgloss.Color("...")`.
- The marker is byte-identical to Desktop's: `!!GitHub_Desktop<branch>`.
- Stash entries are addressed by `stashSha` and re-resolved to their `stash@{n}` name immediately before each git call. Never cache or pass an index.
- Lift, don't duplicate: one menu engine (`picker.Menu`), one committed-pane renderer (History and the stash view), `clip`/`clipOn` before `Width()`. lipgloss `Width()` WRAPS rather than truncates. Every painted line is mirrored exactly by the hit test that reads it.
- UI copy is GitHub Desktop's macOS copy verbatim (spec section 4).
- After any change under `ui/`, run `bun run ui:build`. Never `git add ui/dist/rt-ui` or `docs/design/mission/mission.pen` (the controller commits the board).
- A built binary is only ever run under an isolated HOME (`env -i HOME=<tmp> PATH=$PATH ...`).
- Worktree sessions refuse compound shell commands: run plain single commands (no `&&`, heredocs, `cd x && ...`, or `git -C`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Test commands (run sequentially; another session shares the machine): `bun test packages/git-core`, `bun test lib/mission`, `bun test lib/ui`, `bun test commands`, `bunx tsc --noEmit`, from `ui/`: `go test ./internal/views/picker/ ./internal/views/mission/ ./internal/protocol/`, and `bun run test:pty`.

## Rulings made while planning

1. **`stashEntryCount` is not ported.** Nothing in glitter shows it, and Desktop's `entries.length - 1` undercounts by one with the shared log parser (`createLogParser` returns exact entries). The spec was updated.
2. **The driver owns whether the stash view shows** (Desktop's Changes-selection kind), and while it shows, the existing `diff` field carries the stash file's read-only diff. No `stashDiff` field; the Go diff pane keeps one source. The spec was updated.
3. **Switch Branch shows each option's Desktop description as a greyed row under it,** and the overwrite warning as a static greyed row when the branch has a stash. `picker.Menu` has no footer and rows do not change with the cursor. The spec was updated.
4. **`GitExitError` carries `stdout` and `stderr`.** Desktop's stash code reads git's streams (exit 1 with or without an `error: ` line; empty stderr); rawGit's message format is unchanged.
5. **The pop classification ports Desktop's `expectedErrors: MergeConflicts` as dugite's pattern tested on stderr, then stdout.** dugite's full first-match table is not vendored. A probe on git 2.54 showed a conflicting `stash pop --quiet` exits 1 with empty stderr and stdout "The stash entry is kept in case you need it again.", so the live path is Desktop's exit-1-empty-stderr drop.
6. **`stashCount` stays on the wire until Task 5,** which removes it from TS, Go, and both fixtures in one task: the fixtures feed Go tests, so removing the field earlier breaks Go in a task that does not touch Go.
7. **No busy flag.** Commit and undo run on the serial intent loop without one; stash intents do the same.
8. **Stash file moves emit immediately.** Stash lists are short; History's debounce is not copied.
9. **Stashed file rows have no context menu** (Desktop's stash file list has none); their `onDisk` is false.
10. **Unborn and detached both have `snapshot.branch === null`** in rt's snapshot, so `canStash` is false for both and a switch from either forces `bring`, matching Desktop's `tip.kind !== TipState.Valid` rule.
11. **The fake `GitClient` in `lib/mission/__tests__/driver.test.ts` gains every new method in Task 2,** so the root `tsc` stays green from the task that changes the interface.

## Review Focus

1. **Another session changes the shared stash stack between list and act** (a `git stash` pushed on top shifts every index): Restore and Discard still act on the right entry because they re-resolve by sha. Test in Task 2 (`drop and pop resolve by sha after another stash shifts the stack`).
2. **A stash made outside glitter:** a Desktop-tagged stash made in GitHub Desktop shows on the strip after the next git-status sweep; a plain `git stash` never shows. Tests in Task 2 (untagged entries skipped) and Task 4 (a sweep picks up a stash made behind the driver's back).
3. **Branch names with slashes and dashes** (`feature/a-b`): the marker round-trips and the entry matches its branch. Test in Task 2.
4. **The tree changes between the prompt and the answer:** Leave on a tree that became clean makes no stash and still switches; Bring whose checkout would overwrite an untracked file carries it through the temporary stash. Tests in Task 3 (leave with no changes) and Task 2 (`isLocalChangesOverwrittenError` matches both git messages) plus Task 4's compose bring test.
5. **The stash view is open when the entry disappears** (restored elsewhere, dropped by another session): the view closes, focus returns to the Changes list, and no stale diff stays on screen. Tests in Task 3 (`load` with the entry gone clears `showing`) and Task 5 (`SetModel` with `Stash` nil while `focusStashFiles`).

## File Structure

| File | Responsibility |
|---|---|
| `packages/git-core/src/desktop-stash.ts` (new) | GHD `stash.ts` port: marker, list, latest-for-branch, create, drop, pop, stashed files, the overwrite-error check. |
| `packages/git-core/src/exec.ts` | `GitExitError` gains `stdout`/`stderr`. |
| `packages/git-core/src/types.ts`, `client.ts`, `index.ts` | New `GitClient` methods and exports. |
| `lib/mission/stash.ts` (new) | GHD app-store sequencing (`createStashAndDropPreviousEntry`, `checkoutAndLeaveChanges`, `checkoutAndBringChanges`), `canStash`, and `StashStore`. |
| `lib/mission/driver.ts` | Stash intents, the switch prompt, stash loading on refresh and sweep, `discard-all`. |
| `lib/mission/model.ts`, `lib/mission/history-model.ts`, `lib/ui/protocol.ts` | Wire: `stash`, `switchPrompt`, `canStash`; the stash diff through `diff`; `committedFileRow` exported. |
| `ui/internal/views/mission/model.go` | Go wire structs. |
| `ui/internal/views/mission/history.go` | `committedPane`: History's right pane lifted into a shared renderer and hit test. |
| `ui/internal/views/mission/stash.go` (new) | Strip, stash view header and buttons, stash keys and focus, stash dialogs, switch prompt. |
| `ui/internal/views/mission/mission.go`, `changes.go`, `diff.go`, `menu.go` | Routing, strip, keybar, empty-state line, list menu, board rows. |
| `ui/internal/theme/theme.go` | `GlyphStash`. |
| `ui/fixtures/session-model-mission.json`, `session-model-mission-history.json` | Fixtures gain the new fields and lose `stashCount`. |
| `e2e/pty/glitter.test.ts` | Stash round trip through the binary. |
| `docs/design/mission/README.md`, `mission.pen`, `Stash.png`, `StashStates.png` (new) | Boards, README sections, deviations. |

---

### Task 1: Stash boards (controller-owned, gated on Matt)

**Files:**
- Modify: `docs/design/mission/mission.pen` (through the Pencil MCP only)
- Create: `docs/design/mission/Stash.png`, `docs/design/mission/StashStates.png`

This task is the controller's. It runs while Tasks 2 to 4 are implemented; Task 5 does not start until Matt has signed off the exported pictures (open them for him; a bare path does not count).

- [ ] **Step 1: Draw `Stash.png`** beside the History boards: the Changes tab with the "Stashed Changes ❯" strip at rest, hovered, and selected (view open); the stash view in the right pane: header ("Stashed changes", Restore and Discard buttons, "Restore will move your stashed files to the Changes list."), the rule, the "N changed files" column with a cursor row, and a read-only diff; the stash keybar (`↑↓ files · enter diff · R restore · D discard · h hide · ⌃k menu …`). Pick the strip's stash icon (a Nerd Font octicon, like the top-bar segments).
- [ ] **Step 2: Draw `StashStates.png`:** Switch Branch without and with a stash (the warning row), Overwrite Stash?, Discard Stash?, Discard All Changes, the Changes list menu with both rows enabled and with Stash All Changes greyed, ctrl-k's board section with `S` and `h`, and the empty-state card with the "view your stashed changes" line. Tokens from `theme.go` only: Surface box, Panel border, SelBg + Pink bar cursor, HoverBg hover, TextSoft rows, Faint disabled and body rows, Peach warning glyph, KeybarKey hints, Rule dividers.
- [ ] **Step 3: Export** both PNGs, `open` them for Matt, and get his sign-off.
- [ ] **Step 4: Commit** after Matt saves in Pencil: `git add docs/design/mission/mission.pen docs/design/mission/Stash.png docs/design/mission/StashStates.png`, message `docs: stash boards`.

---

### Task 2: git-core: GitHub Desktop's stash port

**Files:**
- Create: `packages/git-core/src/desktop-stash.ts`, `packages/git-core/src/__tests__/desktop-stash.test.ts`
- Modify: `packages/git-core/src/exec.ts`, `packages/git-core/src/types.ts`, `packages/git-core/src/client.ts`, `packages/git-core/src/index.ts`, `packages/git-core/src/__tests__/exec-exit-code.test.ts`, `packages/git-core/src/__tests__/client-shape.test.ts`, `lib/mission/__tests__/driver.test.ts` (fake client only)

**Interfaces:**
- Consumes: `rawGit`, `isGitExitCode` (`exec.ts`); `rawGitOr128` (`discard.ts`); `createLogParser`, `parseRawLogWithNumstat`, `CommittedFileChange` (`vendor/ghd/log-parse.ts`).
- Produces:
  - `interface DesktopStashEntry { name: string; stashSha: string; branchName: string; tree: string; parents: string[] }` (exported from `types.ts`)
  - `GitClient.desktopStashes(): Promise<DesktopStashEntry[]>`
  - `GitClient.lastDesktopStashEntryForBranch(branch: string): Promise<DesktopStashEntry | null>`
  - `GitClient.createDesktopStashEntry(branch: string, untrackedPaths: ReadonlyArray<string>): Promise<boolean>`
  - `GitClient.dropDesktopStashEntry(stashSha: string): Promise<void>`
  - `GitClient.popStashEntry(stashSha: string): Promise<void>`
  - `GitClient.stashedFiles(stashSha: string): Promise<CommittedFileChange[]>`
  - `isLocalChangesOverwrittenError(err: unknown): boolean`, `createDesktopStashMessage(branch: string): string`, `DesktopStashEntryMarker` (exported from `index.ts`)
  - `GitExitError.stdout: string`, `GitExitError.stderr: string`

- [ ] **Step 1: Write the failing exec test** in `exec-exit-code.test.ts`:

```ts
it("carries git's stdout and stderr on an exit-code failure", async () => {
  const sb = await makeSandbox();
  try {
    let caught: unknown;
    try {
      await rawGit(sb.dir, ["rev-parse", "--verify", "no-such-ref"]);
    } catch (e) {
      caught = e;
    }
    expect(isGitExitCode(caught, 128)).toBe(true);
    const err = caught as GitExitError;
    expect(err.stderr).toContain("fatal:");
    expect(typeof err.stdout).toBe("string");
  } finally {
    await sb.cleanup();
  }
});
```

- [ ] **Step 2: Run** `bun test packages/git-core/src/__tests__/exec-exit-code.test.ts`. Expected: FAIL (`err.stderr` is undefined).

- [ ] **Step 3: Implement** in `exec.ts`:

```ts
export interface GitExitError extends Error {
  exitCode: number;
  stdout: string;
  stderr: string;
}
```

and in `rawGit`'s classification throw, after `error.exitCode = code;`:

```ts
      error.stdout = out;
      error.stderr = err;
```

- [ ] **Step 4: Run** the same test. Expected: PASS.

- [ ] **Step 5: Write the failing port tests** in `desktop-stash.test.ts`. Every sandbox sets identity in repo config, because `rawGit` passes no `-c` identity and `stash push` writes commits:

```ts
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox, type Sandbox } from "../../test-support/sandbox.ts";
import { createGitClient, createDesktopStashMessage, isLocalChangesOverwrittenError } from "../index.ts";

async function seeded(): Promise<Sandbox> {
  const sb = await makeSandbox();
  await sb.git(["config", "user.email", "test@example.com"]);
  await sb.git(["config", "user.name", "Test"]);
  await sb.git(["config", "commit.gpgsign", "false"]);
  await sb.write("a.txt", "1\n2\n3\n4\n5\n");
  await sb.commitAll("first");
  return sb;
}

async function stashMessages(sb: Sandbox): Promise<string[]> {
  return (await sb.git(["log", "-g", "--format=%gs", "refs/stash", "--"])).split("\n").filter(Boolean);
}

describe("desktop stash port", () => {
  it("formats Desktop's marker byte for byte", () => {
    expect(createDesktopStashMessage("feature/a-b")).toBe("!!GitHub_Desktop<feature/a-b>");
  });

  it("lists nothing when the repo has no stash", async () => {
    const sb = await seeded();
    try {
      expect(await createGitClient(sb.dir).desktopStashes()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("creates a tagged stash that includes untracked files and empties the tree", async () => {
    const sb = await seeded();
    try {
      await sb.write("a.txt", "1\n2\n3\n4\nfive\n");
      await sb.write("new.txt", "untracked\n");
      const client = createGitClient(sb.dir);
      expect(await client.createDesktopStashEntry("main", ["new.txt"])).toBe(true);
      expect(await stashMessages(sb)).toEqual(["On main: !!GitHub_Desktop<main>"]);
      expect(await sb.git(["status", "--porcelain"])).toBe("");
      expect(existsSync(join(sb.dir, "new.txt"))).toBe(false);
      const [entry] = await client.desktopStashes();
      expect(entry?.branchName).toBe("main");
      expect(entry?.name).toBe("refs/stash@{0}");
      expect(entry?.parents.length).toBe(2);
      const files = (await client.stashedFiles(entry!.stashSha)).map((f) => f.path).sort();
      expect(files).toEqual(["a.txt", "new.txt"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("returns false and makes no entry when there is nothing to stash", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      expect(await client.createDesktopStashEntry("main", [])).toBe(false);
      expect(await client.desktopStashes()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("skips stashes Desktop did not make, and finds the newest per branch", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "one\n");
      await client.createDesktopStashEntry("feature/a-b", []);
      await sb.write("a.txt", "two\n");
      await sb.git(["stash", "push", "-m", "plain"]);
      await sb.write("a.txt", "three\n");
      await client.createDesktopStashEntry("feature/a-b", []);
      const entries = await client.desktopStashes();
      expect(entries.map((e) => e.branchName)).toEqual(["feature/a-b", "feature/a-b"]);
      const newest = await client.lastDesktopStashEntryForBranch("feature/a-b");
      expect(newest?.stashSha).toBe(entries[0]!.stashSha);
      expect(await client.lastDesktopStashEntryForBranch("main")).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  it("drop and pop resolve by sha after another stash shifts the stack", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "mine\n");
      await client.createDesktopStashEntry("main", []);
      const mine = (await client.lastDesktopStashEntryForBranch("main"))!;
      await sb.write("b.txt", "someone else\n");
      await sb.git(["add", "b.txt"]);
      await sb.git(["stash", "push", "-m", "another session"]);
      await client.popStashEntry(mine.stashSha);
      expect(await Bun.file(join(sb.dir, "a.txt")).text()).toBe("mine\n");
      expect(await stashMessages(sb)).toEqual(["On main: another session"]);

      await sb.git(["checkout", "--", "a.txt"]);
      await sb.write("a.txt", "again\n");
      await client.createDesktopStashEntry("main", []);
      const again = (await client.lastDesktopStashEntryForBranch("main"))!;
      await sb.write("c.txt", "c\n");
      await sb.git(["add", "c.txt"]);
      await sb.git(["stash", "push", "-m", "on top"]);
      await client.dropDesktopStashEntry(again.stashSha);
      expect(await stashMessages(sb)).toEqual(["On main: on top", "On main: another session"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("a pop that conflicts leaves the conflict in the tree and drops the entry", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "stashed\n");
      await client.createDesktopStashEntry("main", []);
      const entry = (await client.lastDesktopStashEntryForBranch("main"))!;
      await sb.write("a.txt", "committed\n");
      await sb.commitAll("conflicting");
      await client.popStashEntry(entry.stashSha);
      expect(await client.desktopStashes()).toEqual([]);
      expect(await sb.git(["status", "--porcelain"])).toContain("UU a.txt");
    } finally {
      await sb.cleanup();
    }
  });

  it("a pop git refuses keeps the entry and throws", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "stashed\n");
      await client.createDesktopStashEntry("main", []);
      const entry = (await client.lastDesktopStashEntryForBranch("main"))!;
      await sb.write("a.txt", "dirty\n");
      await expect(client.popStashEntry(entry.stashSha)).rejects.toThrow("would be overwritten");
      expect((await client.desktopStashes()).length).toBe(1);
    } finally {
      await sb.cleanup();
    }
  });

  it("pop and drop of a sha that is gone do nothing", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await client.popStashEntry("0".repeat(40));
      await client.dropDesktopStashEntry("0".repeat(40));
      expect(await client.desktopStashes()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("recognizes both of git's checkout-overwrite refusals", async () => {
    const sb = await seeded();
    try {
      await sb.git(["checkout", "-b", "other"]);
      await sb.write("a.txt", "other\n");
      await sb.write("b.txt", "tracked on other\n");
      await sb.commitAll("other");
      await sb.git(["checkout", "main"]);
      const client = createGitClient(sb.dir);

      await sb.write("a.txt", "dirty\n");
      const tracked = await client.checkoutBranch("other").then(() => null, (e: unknown) => e);
      expect(isLocalChangesOverwrittenError(tracked)).toBe(true);

      await sb.git(["checkout", "--", "a.txt"]);
      await sb.write("b.txt", "untracked here\n");
      const untracked = await client.checkoutBranch("other").then(() => null, (e: unknown) => e);
      expect(isLocalChangesOverwrittenError(untracked)).toBe(true);

      expect(isLocalChangesOverwrittenError(new Error("fatal: something else"))).toBe(false);
      expect(isLocalChangesOverwrittenError("not an error")).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });
});
```

In `client-shape.test.ts`, add one `expect(typeof client.<name>).toBe("function")` line for each of the six new methods.

- [ ] **Step 6: Run** `bun test packages/git-core/src/__tests__/desktop-stash.test.ts`. Expected: FAIL (`createDesktopStashMessage` is not exported).

- [ ] **Step 7: Implement `desktop-stash.ts`:**

```ts
import type { ClientContext } from "./client.ts";
import { rawGitOr128 } from "./discard.ts";
import { hasGitExitCode, isGitExitCode, rawGit } from "./exec.ts";
import type { DesktopStashEntry } from "./types.ts";
import { createLogParser, parseRawLogWithNumstat, type CommittedFileChange } from "./vendor/ghd/log-parse.ts";

/** GHD app/src/lib/git/stash.ts; a stash made here shows in GitHub Desktop and the reverse. */
export const DesktopStashEntryMarker = "!!GitHub_Desktop";

const desktopStashEntryMessageRe = /!!GitHub_Desktop<(.+)>$/;

/** dugite's GitError.LocalChangesOverwritten pattern (lib/errors.js), unflagged as dugite applies it. */
const localChangesOverwrittenRe = new RegExp(
  "error: (?:Your local changes to the following|The following untracked working tree) files would be overwritten by checkout:",
);

/** dugite's GitError.MergeConflicts pattern, the one error GHD's popStashEntry expects. */
const mergeConflictsRe = new RegExp("(Merge conflict|Automatic merge failed; fix conflicts and then commit the result)");

export function createDesktopStashMessage(branchName: string): string {
  return `${DesktopStashEntryMarker}<${branchName}>`;
}

function extractBranchFromMessage(message: string): string | null {
  const match = desktopStashEntryMessageRe.exec(message);
  return match === null || match[1]!.length === 0 ? null : match[1]!;
}

/** GHD getStashes without stashEntryCount; newest first (reflog order). */
export async function getDesktopStashes(ctx: ClientContext): Promise<DesktopStashEntry[]> {
  const { formatArgs, parse } = createLogParser({ name: "%gD", stashSha: "%H", message: "%gs", tree: "%T", parents: "%P" });
  const stdout = await rawGitOr128(ctx.dir, ["log", "-g", ...formatArgs, "refs/stash", "--"]);
  if (stdout === null) return [];
  const entries: DesktopStashEntry[] = [];
  for (const { name, message, stashSha, tree, parents } of parse(stdout)) {
    const branchName = extractBranchFromMessage(message);
    if (branchName !== null) {
      entries.push({ name, stashSha, branchName, tree, parents: parents.length > 0 ? parents.split(" ") : [] });
    }
  }
  return entries;
}

export async function getLastDesktopStashEntryForBranch(ctx: ClientContext, branchName: string): Promise<DesktopStashEntry | null> {
  return (await getDesktopStashes(ctx)).find((e) => e.branchName === branchName) ?? null;
}

/**
 * GHD createDesktopStashEntry. Untracked files are staged first so the stash
 * carries them without `-u`. Exit 1 with no `error: ` line counts as created,
 * GHD's own rule (it also holds for an unborn repo, which callers refuse).
 */
export async function createDesktopStashEntry(
  ctx: ClientContext,
  branchName: string,
  untrackedPaths: ReadonlyArray<string>,
): Promise<boolean> {
  if (untrackedPaths.length > 0) {
    await rawGit(ctx.dir, ["update-index", "--add", "--remove", "--replace", "-z", "--stdin"], { stdin: untrackedPaths.join("\0") });
  }
  let stdout: string;
  try {
    stdout = await rawGit(ctx.dir, ["stash", "push", "-m", createDesktopStashMessage(branchName)]);
  } catch (e) {
    if (!isGitExitCode(e, 1) || /^error: /m.test(e.stderr)) throw e;
    stdout = e.stdout;
  }
  return stdout !== "No local changes to save\n";
}

async function entryMatchingSha(ctx: ClientContext, stashSha: string): Promise<DesktopStashEntry | null> {
  return (await getDesktopStashes(ctx)).find((e) => e.stashSha === stashSha) ?? null;
}

export async function dropDesktopStashEntry(ctx: ClientContext, stashSha: string): Promise<void> {
  const entry = await entryMatchingSha(ctx, stashSha);
  if (entry !== null) await rawGit(ctx.dir, ["stash", "drop", entry.name]);
}

/** GHD popStashEntry: a conflicted pop exits 1 with empty stderr and git keeps the entry, so it is dropped here. */
export async function popStashEntry(ctx: ClientContext, stashSha: string): Promise<void> {
  const entry = await entryMatchingSha(ctx, stashSha);
  if (entry === null) return;
  try {
    await rawGit(ctx.dir, ["stash", "pop", "--quiet", entry.name]);
  } catch (e) {
    if (!hasGitExitCode(e)) throw e;
    if (mergeConflictsRe.test(e.stderr) || mergeConflictsRe.test(e.stdout)) return;
    if (e.exitCode === 1 && e.stderr.length === 0) {
      await dropDesktopStashEntry(ctx, stashSha);
      return;
    }
    throw e;
  }
}

export async function getStashedFiles(ctx: ClientContext, stashSha: string): Promise<CommittedFileChange[]> {
  const stdout = await rawGit(ctx.dir, [
    "stash", "show", stashSha, "--raw", "--numstat", "-z", "--format=format:", "--no-show-signature", "--",
  ]);
  return [...parseRawLogWithNumstat(stdout, stashSha, `${stashSha}^`).files];
}

export function isLocalChangesOverwrittenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const stderr = "stderr" in err && typeof (err as { stderr: unknown }).stderr === "string" ? (err as { stderr: string }).stderr : "";
  return localChangesOverwrittenRe.test(stderr) || localChangesOverwrittenRe.test(err.message);
}
```

Add the narrowing helper `popStashEntry` uses to `exec.ts`, beside `isGitExitCode`, and import it in `desktop-stash.ts`:

```ts
export function hasGitExitCode(error: unknown): error is GitExitError {
  return error instanceof Error && "exitCode" in error;
}
```

Check `parseRawLogWithNumstat`'s return type: if `files` is already a mutable array, drop the spread.

Wire it up:
- `types.ts`: add `DesktopStashEntry` (the Interfaces shape above, `name` documented as "the `%gD` selector at list time; re-read before use") and the six methods on `GitClient`, each with a one-line GHD parity comment.
- `client.ts`: import from `./desktop-stash.ts` and add `desktopStashes: () => getDesktopStashes(ctx)`, `lastDesktopStashEntryForBranch: (b) => getLastDesktopStashEntryForBranch(ctx, b)`, `createDesktopStashEntry: (b, u) => createDesktopStashEntry(ctx, b, u)`, `dropDesktopStashEntry: (s) => dropDesktopStashEntry(ctx, s)`, `popStashEntry: (s) => popStashEntry(ctx, s)`, `stashedFiles: (s) => getStashedFiles(ctx, s)`.
- `index.ts`: `export { createDesktopStashMessage, DesktopStashEntryMarker, isLocalChangesOverwrittenError } from "./desktop-stash.ts";`
- `lib/mission/__tests__/driver.test.ts`: add the six methods to the fake client beside `stashDrop` (`desktopStashes: async () => []`, `lastDesktopStashEntryForBranch: async () => null`, `createDesktopStashEntry: async () => false`, `dropDesktopStashEntry: async () => {}`, `popStashEntry: async () => {}`, `stashedFiles: async () => []`).

- [ ] **Step 8: Run** `bun test packages/git-core`, then `bunx tsc --noEmit`. Expected: PASS, no type errors.

- [ ] **Step 9: Commit** `git add packages/git-core lib/mission/__tests__/driver.test.ts`, message `git-core: port GitHub Desktop's stash methods`.

---

### Task 3: The stash store: Desktop's sequencing

**Files:**
- Create: `lib/mission/stash.ts`, `lib/mission/__tests__/stash.test.ts`

**Interfaces:**
- Consumes: Task 2's `GitClient` methods, `isLocalChangesOverwrittenError`, `DesktopStashEntry`; existing `GitClient.checkoutBranch`, `GitClient.commitDiff`, `RepoSnapshot`, `CommittedFileChange`, `StagingDiff`.
- Produces:
  - `type SwitchStrategy = "leave" | "bring"`
  - `canStash(snapshot: RepoSnapshot): boolean`
  - `untrackedPaths(snapshot: RepoSnapshot): string[]`
  - `createStashAndDropPreviousEntry(client: GitClient, branch: string, untracked: ReadonlyArray<string>): Promise<boolean>`
  - `checkoutAndLeaveChanges(client: GitClient, target: string, snapshot: RepoSnapshot): Promise<string>` (returns a notice, "" when none)
  - `checkoutAndBringChanges(client: GitClient, target: string, snapshot: RepoSnapshot): Promise<void>`
  - `class StashStore { entry; files; showing; selectedFile; diff; load(client, branch); select(client, path?); hide(); showOversized(path); isOversizedShown(path); reset() }`

- [ ] **Step 1: Write the failing tests** in `lib/mission/__tests__/stash.test.ts`, with a recording fake client (only the methods this module calls; cast through `unknown` to `GitClient`):

```ts
import { describe, expect, test } from "bun:test";
import type { DesktopStashEntry, GitClient, RepoSnapshot } from "../../../packages/git-core/src/index.ts";
import {
  StashStore,
  canStash,
  checkoutAndBringChanges,
  checkoutAndLeaveChanges,
  createStashAndDropPreviousEntry,
  untrackedPaths,
} from "../stash.ts";

function entry(sha: string, branchName = "main"): DesktopStashEntry {
  return { name: "refs/stash@{0}", stashSha: sha, branchName, tree: "t", parents: ["p"] };
}

function snap(over: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    branch: "main", detached: false, upstream: null, ahead: null, behind: null,
    files: [{ path: "a.txt", kind: "modified", staged: false, unstaged: true }], clean: false, ...over,
  };
}

function fake(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const client = {
    lastDesktopStashEntryForBranch: async (b: string) => (calls.push(`last ${b}`), null),
    createDesktopStashEntry: async (b: string, u: ReadonlyArray<string>) => (calls.push(`create ${b} [${u.join(",")}]`), true),
    dropDesktopStashEntry: async (s: string) => void calls.push(`drop ${s}`),
    popStashEntry: async (s: string) => void calls.push(`pop ${s}`),
    checkoutBranch: async (n: string) => void calls.push(`checkout ${n}`),
    stashedFiles: async (s: string) => (calls.push(`files ${s}`), [{ path: "a.txt", status: { kind: "Modified" } }]),
    commitDiff: async (f: { path: string }, s: string) => (calls.push(`diff ${f.path} ${s}`), { path: f.path, kind: "text", untracked: false, hunks: [] }),
    ...over,
  };
  return { client: client as unknown as GitClient, calls };
}

describe("canStash", () => {
  test("needs changes, a branch tip, and no conflicts", () => {
    expect(canStash(snap())).toBe(true);
    expect(canStash(snap({ files: [] }))).toBe(false);
    expect(canStash(snap({ branch: null, detached: true }))).toBe(false);
    expect(canStash(snap({ branch: null }))).toBe(false);
    expect(canStash(snap({ files: [{ path: "a", kind: "conflicted", staged: false, unstaged: true }] }))).toBe(false);
  });

  test("untrackedPaths lists only untracked files", () => {
    const s = snap({ files: [{ path: "a", kind: "modified", staged: false, unstaged: true }, { path: "n", kind: "untracked", staged: false, unstaged: true }] });
    expect(untrackedPaths(s)).toEqual(["n"]);
  });
});

describe("createStashAndDropPreviousEntry", () => {
  test("creates first, then drops the branch's previous entry", async () => {
    const { client, calls } = fake({ lastDesktopStashEntryForBranch: async () => entry("old") });
    expect(await createStashAndDropPreviousEntry(client, "main", ["n"])).toBe(true);
    expect(calls).toEqual(["create main [n]", "drop old"]);
  });

  test("keeps the previous entry when nothing was stashed", async () => {
    const { client, calls } = fake({
      lastDesktopStashEntryForBranch: async () => entry("old"),
      createDesktopStashEntry: async () => false,
    });
    expect(await createStashAndDropPreviousEntry(client, "main", [])).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("checkoutAndLeaveChanges", () => {
  test("stashes on the current branch, then checks out", async () => {
    const { client, calls } = fake();
    expect(await checkoutAndLeaveChanges(client, "other", snap())).toBe("");
    expect(calls).toEqual(["last main", "create main []", "checkout other"]);
  });

  test("a tree that became clean makes no stash and still switches", async () => {
    const { client, calls } = fake();
    await checkoutAndLeaveChanges(client, "other", snap({ files: [] }));
    expect(calls).toEqual(["checkout other"]);
  });

  test("a failed stash is reported and the checkout still runs", async () => {
    const { client, calls } = fake({ createDesktopStashEntry: async () => { throw new Error("boom"); } });
    expect(await checkoutAndLeaveChanges(client, "other", snap())).toBe("boom");
    expect(calls).toEqual(["last main", "checkout other"]);
  });
});

describe("checkoutAndBringChanges", () => {
  const overwrite = Object.assign(new Error("checkout failed"), {
    stderr: "error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n",
  });

  test("a checkout that succeeds carries the changes and stashes nothing", async () => {
    const { client, calls } = fake();
    await checkoutAndBringChanges(client, "other", snap());
    expect(calls).toEqual(["checkout other"]);
  });

  test("an overwrite refusal moves the changes through a stash tagged for the target", async () => {
    let first = true;
    const { client, calls } = fake({
      checkoutBranch: async (n: string) => {
        calls.push(`checkout ${n}`);
        if (first) {
          first = false;
          throw overwrite;
        }
      },
      lastDesktopStashEntryForBranch: async (b: string) => (calls.push(`last ${b}`), entry("tmp", b)),
    });
    await checkoutAndBringChanges(client, "other", snap({ files: [{ path: "n", kind: "untracked", staged: false, unstaged: true }] }));
    expect(calls).toEqual(["checkout other", "create other [n]", "last other", "checkout other", "pop tmp"]);
  });

  test("an overwrite refusal with nothing stashable rethrows the checkout error", async () => {
    const { client } = fake({
      checkoutBranch: async () => { throw overwrite; },
      createDesktopStashEntry: async () => false,
    });
    await expect(checkoutAndBringChanges(client, "other", snap())).rejects.toBe(overwrite);
  });

  test("any other checkout failure is rethrown untouched", async () => {
    const other = new Error("fatal: invalid reference");
    const { client, calls } = fake({ checkoutBranch: async () => { throw other; } });
    await expect(checkoutAndBringChanges(client, "other", snap())).rejects.toBe(other);
    expect(calls).toEqual([]);
  });
});

describe("StashStore", () => {
  test("loads the branch's entry and its files once per sha", async () => {
    const { client, calls } = fake({ lastDesktopStashEntryForBranch: async () => entry("s1") });
    const store = new StashStore();
    await store.load(client, "main");
    await store.load(client, "main");
    expect(store.entry?.stashSha).toBe("s1");
    expect(store.files?.map((f) => f.path)).toEqual(["a.txt"]);
    expect(calls.filter((c) => c.startsWith("files"))).toEqual(["files s1"]);
  });

  test("a null branch has no entry", async () => {
    const { client } = fake({ lastDesktopStashEntryForBranch: async () => entry("s1") });
    const store = new StashStore();
    await store.load(client, null);
    expect(store.entry).toBeNull();
  });

  test("select opens the view on the first file and loads its diff from the stash sha", async () => {
    const { client, calls } = fake({ lastDesktopStashEntryForBranch: async () => entry("s1") });
    const store = new StashStore();
    await store.load(client, "main");
    await store.select(client);
    expect(store.showing).toBe(true);
    expect(store.selectedFile?.path).toBe("a.txt");
    expect(store.diff?.path).toBe("a.txt");
    expect(calls).toContain("diff a.txt s1");
    store.hide();
    expect(store.showing).toBe(false);
  });

  test("the view closes when the entry disappears", async () => {
    let current: DesktopStashEntry | null = entry("s1");
    const { client } = fake({ lastDesktopStashEntryForBranch: async () => current });
    const store = new StashStore();
    await store.load(client, "main");
    await store.select(client);
    current = null;
    await store.load(client, "main");
    expect(store.entry).toBeNull();
    expect(store.showing).toBe(false);
    expect(store.files).toBeNull();
    expect(store.diff).toBeNull();
  });

  test("a new stash on the same branch reloads files and reselects while showing", async () => {
    let current = entry("s1");
    const { client, calls } = fake({ lastDesktopStashEntryForBranch: async () => current });
    const store = new StashStore();
    await store.load(client, "main");
    await store.select(client);
    current = entry("s2");
    await store.load(client, "main");
    expect(store.entry?.stashSha).toBe("s2");
    expect(store.showing).toBe(true);
    expect(calls).toContain("diff a.txt s2");
  });
});
```

- [ ] **Step 2: Run** `bun test lib/mission/__tests__/stash.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/mission/stash.ts`:**

```ts
import {
  isLocalChangesOverwrittenError,
  type CommittedFileChange,
  type DesktopStashEntry,
  type GitClient,
  type RepoSnapshot,
  type StagingDiff,
} from "../../packages/git-core/src/index.ts";

export type SwitchStrategy = "leave" | "bring";

/** GHD filter-changes-list.tsx onContextMenu's Stash All Changes enablement. */
export function canStash(snapshot: RepoSnapshot): boolean {
  return snapshot.files.length > 0 && snapshot.branch !== null && !snapshot.files.some((f) => f.kind === "conflicted");
}

export function untrackedPaths(snapshot: RepoSnapshot): string[] {
  return snapshot.files.filter((f) => f.kind === "untracked").map((f) => f.path);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** GHD app-store createStashAndDropPreviousEntry: the old entry goes only once the new one exists. */
export async function createStashAndDropPreviousEntry(
  client: GitClient,
  branch: string,
  untracked: ReadonlyArray<string>,
): Promise<boolean> {
  const previous = await client.lastDesktopStashEntryForBranch(branch);
  const created = await client.createDesktopStashEntry(branch, untracked);
  if (created && previous !== null) await client.dropDesktopStashEntry(previous.stashSha);
  return created;
}

/** GHD checkoutAndLeaveChanges: a failed stash is reported and the checkout still runs (performFailableOperation). */
export async function checkoutAndLeaveChanges(client: GitClient, target: string, snapshot: RepoSnapshot): Promise<string> {
  let notice = "";
  if (snapshot.branch !== null && snapshot.files.length > 0) {
    try {
      await createStashAndDropPreviousEntry(client, snapshot.branch, untrackedPaths(snapshot));
    } catch (err) {
      notice = message(err);
    }
  }
  await client.checkoutBranch(target);
  return notice;
}

/** GHD checkoutAndBringChanges: the transient stash is tagged for the target and never replaces its own stash. */
export async function checkoutAndBringChanges(client: GitClient, target: string, snapshot: RepoSnapshot): Promise<void> {
  try {
    await client.checkoutBranch(target);
  } catch (checkoutError) {
    if (!isLocalChangesOverwrittenError(checkoutError)) throw checkoutError;
    const stash = (await client.createDesktopStashEntry(target, untrackedPaths(snapshot)))
      ? await client.lastDesktopStashEntryForBranch(target)
      : null;
    if (stash === null) throw checkoutError;
    await client.checkoutBranch(target);
    await client.popStashEntry(stash.stashSha);
  }
}

/** GHD git-store's currentBranchStashEntry and its lazily loaded files, plus the Changes-selection "stash" kind. */
export class StashStore {
  entry: DesktopStashEntry | null = null;
  files: CommittedFileChange[] | null = null;
  showing = false;
  selectedFile: CommittedFileChange | null = null;
  diff: StagingDiff | null = null;
  private oversized = new Set<string>();
  private generation = 0;

  reset(): void {
    this.generation++;
    this.entry = null;
    this.clearEntryState();
  }

  async load(client: GitClient, branch: string | null): Promise<void> {
    const gen = ++this.generation;
    const next = branch === null ? null : await client.lastDesktopStashEntryForBranch(branch);
    if (gen !== this.generation) return;
    if (next === null) {
      this.entry = null;
      this.clearEntryState();
      return;
    }
    if (this.entry?.stashSha === next.stashSha && this.files !== null) {
      this.entry = next;
      return;
    }
    const keepPath = this.selectedFile?.path;
    this.entry = next;
    this.files = null;
    this.selectedFile = null;
    this.diff = null;
    this.oversized = new Set();
    const files = await client.stashedFiles(next.stashSha);
    if (gen !== this.generation) return;
    this.files = files;
    if (this.showing) await this.select(client, keepPath);
  }

  async select(client: GitClient, path?: string): Promise<void> {
    const entry = this.entry;
    if (entry === null) return;
    this.showing = true;
    const files = this.files ?? [];
    const file = (path !== undefined ? files.find((f) => f.path === path) : undefined) ?? files[0] ?? null;
    this.selectedFile = file;
    this.diff = null;
    if (file === null) return;
    const diff = await client.commitDiff(file, entry.stashSha);
    if (this.entry?.stashSha === entry.stashSha && this.selectedFile === file) this.diff = diff;
  }

  hide(): void {
    this.showing = false;
  }

  showOversized(path: string): void {
    this.oversized.add(path);
  }

  isOversizedShown(path: string): boolean {
    return this.oversized.has(path);
  }

  private clearEntryState(): void {
    this.files = null;
    this.showing = false;
    this.selectedFile = null;
    this.diff = null;
    this.oversized = new Set();
  }
}
```

- [ ] **Step 4: Run** `bun test lib/mission/__tests__/stash.test.ts`, then `bunx tsc --noEmit`. Expected: PASS.

- [ ] **Step 5: Commit** `git add lib/mission/stash.ts lib/mission/__tests__/stash.test.ts`, message `glitter: port GitHub Desktop's stash sequencing`.

---

### Task 4: Driver and wire

**Files:**
- Modify: `lib/ui/protocol.ts`, `lib/mission/model.ts`, `lib/mission/history-model.ts`, `lib/mission/driver.ts`, `ui/fixtures/session-model-mission.json`, `ui/fixtures/session-model-mission-history.json`, `lib/ui/__tests__/protocol.test.ts`, `lib/mission/__tests__/model.test.ts`, `lib/mission/__tests__/menu-action.test.ts`
- Create: `lib/mission/__tests__/compose-stash.test.ts`

**Interfaces:**
- Consumes: Task 3's module; Task 2's `GitClient` methods.
- Produces (wire, consumed by Tasks 5 and 6):

```ts
export interface MissionStashModel {
  sha: string;
  branch: string;
  /** null while the stash's file list loads. */
  files: MissionHistoryFileRow[] | null;
  /** The stash view is open; `diff` then carries selectedFile's read-only diff on the Changes tab. */
  showing: boolean;
  selectedFile: string;
}

/** One-shot: present on exactly one push per checkout that needs Desktop's leave-or-bring question. */
export interface MissionSwitchPrompt {
  seq: number;
  branch: string;
  current: string;
  hasStash: boolean;
}
```

  `MissionModel` gains `stash: MissionStashModel | null`, `switchPrompt: MissionSwitchPrompt | null`, `canStash: boolean` (`stashCount` stays until Task 5). Intents: `mission:stash {}`, `mission:stash-restore {sha}`, `mission:stash-discard {sha}`, `mission:stash-select {path?, showOversized?}`, `mission:stash-hide {}`, `mission:checkout {branch, strategy?: "leave" | "bring"}`, `mission:menu-action {action: "discard-all"}`.

- [ ] **Step 1: Write the failing model test** in `model.test.ts`: build a model with a `stash` input `{ entry: { name: "refs/stash@{0}", stashSha: "s1", branchName: "main", tree: "t", parents: ["p", "i"] }, files: [<one modified CommittedFileChange for "a.txt", built the way history-model.test.ts builds them>], showing: true, selectedFile: "a.txt" }` and a `stashDiff` input for `a.txt`, on the Changes tab, and assert `model.stash` equals `{ sha: "s1", branch: "main", files: [{ path: "a.txt", origPath: "", status: "modified", onDisk: false }], showing: true, selectedFile: "a.txt" }`, `model.diff.path === "a.txt"`, and `model.diff.readOnly === true`. A second case with `showing: false` asserts `model.diff` is the Changes diff (`readOnly === false`). A third asserts `stash: null` and `switchPrompt: null` and `canStash: false` are the defaults when the inputs are omitted.

- [ ] **Step 2: Write the failing compose tests** in `compose-stash.test.ts`. Copy `compose.test.ts`'s `runGit`, `makeSandbox`, `LiveSession`, and `realDeps` into a small shared helper first: move them to `lib/mission/__tests__/compose-harness.ts` (exported), and change `compose.test.ts` to import them, with no change to its test body. Then:

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MissionDriver } from "../driver.ts";
import type { MissionModel } from "../model.ts";
import { LiveSession, makeSandbox, realDeps, type Sandbox } from "./compose-harness.ts";

async function start(sandbox: Sandbox): Promise<{ session: LiveSession; seed: MissionModel; stop: () => Promise<void> }> {
  const session = new LiveSession();
  const opened: MissionModel[] = [];
  const driver = new MissionDriver(realDeps(sandbox, session, (m) => opened.push(m)), { repo: "sandbox", worktree: sandbox.dir });
  const run = driver.run();
  const deadline = Date.now() + 5_000;
  while (opened.length === 0) {
    if (Date.now() > deadline) throw new Error("driver never opened the session");
    await new Promise((r) => setTimeout(r, 25));
  }
  return {
    session,
    seed: opened[0]!,
    stop: async () => {
      session.send({ name: "quit" });
      await run;
    },
  };
}

async function desktopStashes(sandbox: Sandbox): Promise<string[]> {
  const out = await sandbox.git(["log", "-g", "--format=%gs", "refs/stash", "--"]).catch(() => "");
  return out.split("\n").filter((l) => l.includes("!!GitHub_Desktop<"));
}

async function seeded(): Promise<Sandbox> {
  const sandbox = await makeSandbox();
  await sandbox.write("a.txt", "1\n2\n3\n4\n5\n");
  await sandbox.git(["add", "-A"]);
  await sandbox.git(["commit", "-m", "init"]);
  return sandbox;
}

describe("mission compose: stash against a real repo", () => {
  test("Stash All Changes, the view, and Restore land in git", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.write("a.txt", "1\n2\n3\n4\nfive\n");
      await sandbox.write("u.txt", "untracked\n");
      const { session, seed, stop } = await start(sandbox);
      expect(seed.canStash).toBe(true);
      expect(seed.stash).toBeNull();

      let m = await session.step({ name: "mission:stash", payload: {} });
      expect(m.stash?.branch).toBe("main");
      expect(m.changes).toEqual([]);
      expect(existsSync(join(sandbox.dir, "u.txt"))).toBe(false);
      expect(await desktopStashes(sandbox)).toEqual(["On main: !!GitHub_Desktop<main>"]);

      m = await session.step({ name: "mission:stash-select", payload: {} });
      expect(m.stash?.showing).toBe(true);
      expect(m.stash?.files?.map((f) => f.path).sort()).toEqual(["a.txt", "u.txt"]);
      expect(m.diff.readOnly).toBe(true);
      expect(m.diff.path).toBe(m.stash?.selectedFile);

      m = await session.step({ name: "mission:stash-restore", payload: { sha: m.stash!.sha } });
      expect(m.stash).toBeNull();
      expect(readFileSync(join(sandbox.dir, "a.txt"), "utf8")).toBe("1\n2\n3\n4\nfive\n");
      expect(existsSync(join(sandbox.dir, "u.txt"))).toBe(true);
      expect(await desktopStashes(sandbox)).toEqual([]);
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  });

  test("a second Stash All Changes leaves one entry, and Discard drops it", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.write("a.txt", "first\n");
      const { session, stop } = await start(sandbox);
      await session.step({ name: "mission:stash", payload: {} });
      await sandbox.write("a.txt", "second\n");
      await session.step({ name: "mission:refresh", payload: {} });
      let m = await session.step({ name: "mission:stash", payload: {} });
      expect(await desktopStashes(sandbox)).toEqual(["On main: !!GitHub_Desktop<main>"]);
      m = await session.step({ name: "mission:stash-discard", payload: { sha: m.stash!.sha } });
      expect(m.stash).toBeNull();
      expect(await desktopStashes(sandbox)).toEqual([]);
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  });

  test("switching with changes asks once, and Leave stashes on the old branch", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.git(["branch", "other"]);
      await sandbox.write("a.txt", "dirty\n");
      const { session, stop } = await start(sandbox);

      let m = await session.step({ name: "mission:checkout", payload: { branch: "other" } });
      expect(m.switchPrompt).toEqual({ seq: 1, branch: "other", current: "main", hasStash: false });
      expect((await sandbox.git(["branch", "--show-current"])).trim()).toBe("main");
      m = await session.step({ name: "mission:refresh", payload: {} });
      expect(m.switchPrompt).toBeNull();

      m = await session.step({ name: "mission:checkout", payload: { branch: "other", strategy: "leave" } });
      expect(m.current.branch).toBe("other");
      expect(m.changes).toEqual([]);
      expect(m.stash).toBeNull();
      expect(await desktopStashes(sandbox)).toEqual(["On main: !!GitHub_Desktop<main>"]);

      m = await session.step({ name: "mission:checkout", payload: { branch: "main" } });
      expect(m.switchPrompt).toBeNull();
      expect(m.current.branch).toBe("main");
      expect(m.stash?.branch).toBe("main");
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  });

  test("Bring carries changes through a temporary stash when checkout would overwrite them", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.git(["checkout", "-b", "other"]);
      await sandbox.write("a.txt", "ONE\n2\n3\n4\n5\n");
      await sandbox.git(["commit", "-am", "other edits line 1"]);
      await sandbox.git(["checkout", "main"]);
      await sandbox.write("a.txt", "1\n2\n3\n4\nFIVE\n");
      const { session, stop } = await start(sandbox);

      const m = await session.step({ name: "mission:checkout", payload: { branch: "other", strategy: "bring" } });
      expect(m.current.branch).toBe("other");
      expect(readFileSync(join(sandbox.dir, "a.txt"), "utf8")).toBe("ONE\n2\n3\n4\nFIVE\n");
      expect(await desktopStashes(sandbox)).toEqual([]);
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  });

  test("a detached HEAD never asks and brings the changes", async () => {
    const sandbox = await seeded();
    try {
      await sandbox.git(["branch", "other"]);
      await sandbox.git(["checkout", "--detach"]);
      await sandbox.write("a.txt", "dirty\n");
      const { session, seed, stop } = await start(sandbox);
      expect(seed.canStash).toBe(false);
      const m = await session.step({ name: "mission:checkout", payload: { branch: "other" } });
      expect(m.switchPrompt).toBeNull();
      expect(m.current.branch).toBe("other");
      expect(readFileSync(join(sandbox.dir, "a.txt"), "utf8")).toBe("dirty\n");
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  });

  test("a stash made behind the driver's back shows after a git-status sweep", async () => {
    const sandbox = await seeded();
    try {
      const { session, seed, stop } = await start(sandbox);
      expect(seed.stash).toBeNull();
      await sandbox.write("a.txt", "elsewhere\n");
      await sandbox.git(["stash", "push", "-m", "!!GitHub_Desktop<main>"]);
      const m = await session.sweep();
      expect(m.stash?.branch).toBe("main");
      await stop();
    } finally {
      await sandbox.cleanup();
    }
  });

});
```

`session.sweep()` does not exist yet: add it to the harness's `LiveSession` as "fire the subscribed git-status handler and resolve with the next push". `realDeps.subscribe` must capture the handler it is given (`subscribe: (onEvent) => { session.onEvent = onEvent; return { close: () => {} }; }`), and `sweep()` calls `this.onEvent?.({ type: "git-status", data: {} })` then waits for a push exactly as `step` does.

Discard All is tested against the fake client in `menu-action.test.ts`, never against real git: git-core's `discardChanges` moves files to the real macOS Trash. Beside the `discard-file` tests, with the file's existing `run`/`menu`/`changed` helpers:

```ts
  test("discard-all discards every changed file from a fresh read and drops the selections", async () => {
    const { calls } = await run([menu({ action: "discard-all" })], {
      client: { files: () => [changed("a.txt"), changed("b.txt", "untracked")] },
    });
    expect(calls.discardChanges).toEqual([[changed("a.txt"), changed("b.txt", "untracked")]]);
  });

  test("discard-all with nothing to discard calls nothing and says so", async () => {
    const { calls, last } = await run([menu({ action: "discard-all" })], { client: { files: () => [] } });
    expect(calls.discardChanges).toEqual([]);
    expect(last.notice).toBe("No changes to discard");
  });
```

- [ ] **Step 3: Run** `bun test lib/mission`. Expected: FAIL (unknown intents; `stash`, `switchPrompt`, `canStash` missing).

- [ ] **Step 4: Implement the wire.**
  - `protocol.ts`: add `MissionStashModel`, `MissionSwitchPrompt` (the Interfaces block) and the three `MissionModel` fields.
  - `history-model.ts`: rename `fileRow` to exported `committedFileRow` (same body); update its one caller.
  - `model.ts`:
    - `MissionState` gains `switchPrompt: MissionSwitchPrompt | null`.
    - `buildModel` input gains `stash?: { entry: DesktopStashEntry; files: CommittedFileChange[] | null; showing: boolean; selectedFile: string } | null`, `stashDiff?: { path: string | null; status: string; diff: StagingDiff | null; oversizedOverride: boolean }`, `canStash?: boolean`.
    - The `diff` choice becomes: History tab, History diff; else when `stash?.showing`, `buildDiffModel({ path: stashDiff.path, status: stashDiff.status, stagingDiff: stashDiff.diff, selection: None, oversizedOverride: stashDiff.oversizedOverride, readOnly: true })`; else the Changes diff.
    - Output: `stash: stash ? { sha: stash.entry.stashSha, branch: stash.entry.branchName, files: stash.files === null ? null : stash.files.map((f) => committedFileRow(f, () => false)), showing: stash.showing, selectedFile: stash.selectedFile } : null`, `switchPrompt: state.switchPrompt ?? null`, `canStash: input.canStash ?? false`.

- [ ] **Step 5: Implement the driver.**
  - Fields: `private readonly stash = new StashStore();`, `private switchSeq = 0;`. `this.state.switchPrompt = null` in the constructor.
  - `setCurrentWorktree`: add `this.stash.reset();` beside `this.history.reset();`.
  - `refresh()`: after `this.snapshot = snapshot;`, `await this.stash.load(client, snapshot.branch);`. Keep `client.stashes()` and `stashCount` as they are.
  - `refreshBadges()`: after the stale-result check and `this.snapshot = snapshot;`, `await this.stash.load(client, snapshot.branch);` and re-check `this.state.currentWorktree !== worktree` after it (return if changed).
  - `model()`: pass `stash: this.stash.entry ? { entry: this.stash.entry, files: this.stash.files, showing: this.stash.showing, selectedFile: this.stash.selectedFile?.path ?? "" } : null`, `stashDiff: { path: this.stash.selectedFile?.path ?? null, status: <the selected row's wire status, via committedFileRow>, diff: this.stash.diff, oversizedOverride: this.stash.selectedFile ? this.stash.isOversizedShown(this.stash.selectedFile.path) : false }`, `canStash: canStash(this.snapshot)`.
  - `handle()`: add cases `mission:stash` → `handleStash()`, `mission:stash-restore` / `mission:stash-discard` → `handleStashEntry(action, payload)`, `mission:stash-select` → `handleStashSelect(payload)`, `mission:stash-hide` → `this.stash.hide(); this.push();`.
  - `handleSelect`: when the payload carries a `path`, `this.stash.hide()` first (Desktop hides the stash on a working-directory selection).
  - New handlers:

```ts
  private async handleStash(): Promise<void> {
    const client = this.deps.client(this.state.currentWorktree);
    this.snapshot = await client.snapshot();
    if (canStash(this.snapshot)) {
      try {
        await createStashAndDropPreviousEntry(client, this.snapshot.branch!, untrackedPaths(this.snapshot));
      } catch (err) {
        this.state.notice = err instanceof Error ? err.message : String(err);
      }
      this.state.selectedPath = null;
    }
    await this.refresh();
    this.push();
  }

  private async handleStashEntry(action: "restore" | "discard", payload: StashEntryPayload | undefined): Promise<void> {
    if (typeof payload?.sha !== "string") return;
    const client = this.deps.client(this.state.currentWorktree);
    try {
      if (action === "restore") await client.popStashEntry(payload.sha);
      else await client.dropDesktopStashEntry(payload.sha);
    } catch (err) {
      this.state.notice = err instanceof Error ? err.message : String(err);
    }
    await this.refresh();
    this.push();
  }

  private async handleStashSelect(payload: StashSelectPayload | undefined): Promise<void> {
    const client = this.deps.client(this.state.currentWorktree);
    if (payload?.showOversized === true && typeof payload.path === "string") this.stash.showOversized(payload.path);
    else await this.stash.select(client, typeof payload?.path === "string" ? payload.path : undefined);
    this.push();
  }
```

  - `handleCheckout`, replacing the plain checkout after the guard (the `new === true` branch and the guard stay as they are):

```ts
    const client = this.deps.client(this.state.currentWorktree);
    const snapshot = await client.snapshot();
    if (snapshot.branch === payload.branch) {
      this.push();
      return;
    }
    const hasChanges = snapshot.files.length > 0;
    const strategy: SwitchStrategy | null = snapshot.branch === null ? "bring" : (payload.strategy ?? null);
    if (strategy === null && hasChanges) {
      this.state.switchPrompt = { seq: ++this.switchSeq, branch: payload.branch, current: snapshot.branch!, hasStash: this.stash.entry !== null };
      this.push();
      this.state.switchPrompt = null;
      return;
    }
    try {
      if (strategy === "leave") this.state.notice = await checkoutAndLeaveChanges(client, payload.branch, snapshot);
      else if (strategy === "bring") await checkoutAndBringChanges(client, payload.branch, snapshot);
      else await client.checkoutBranch(payload.branch);
    } catch (err) {
      this.state.notice = err instanceof Error ? err.message : String(err);
    }
    this.stash.hide();
    this.state.selectedPath = null;
    this.state.selections = new Map();
    await this.refresh();
    this.push();
```

    `CheckoutPayload` gains `strategy?: SwitchStrategy`; a strategy that is neither `"leave"` nor `"bring"` is treated as absent. The existing `this.state.notice = ""` after checkout goes away: `handle()` already clears the notice before every intent, and a Leave notice must survive to the push.
  - `handleMenuAction`: add

```ts
        case "discard-all": {
          this.snapshot = await client.snapshot();
          mutated = true;
          if (this.snapshot.files.length === 0) {
            this.state.notice = "No changes to discard";
            break;
          }
          await client.discardChanges(this.snapshot.files);
          this.state.selections = new Map();
          break;
        }
```

  - Payload interfaces: `StashEntryPayload { sha: string }`, `StashSelectPayload { path?: string; showOversized?: boolean }`.

- [ ] **Step 6: Fixtures.** Add `"stash": null, "switchPrompt": null, "canStash": true` to `ui/fixtures/session-model-mission.json` and `"stash": null, "switchPrompt": null, "canStash": false` to `session-model-mission-history.json` (keep `stashCount`). Extend `lib/ui/__tests__/protocol.test.ts`'s fixture assertions with the three fields.

- [ ] **Step 7: Run** `bun test lib/mission`, `bun test lib/ui`, `bunx tsc --noEmit`, and from `ui/` `go test ./internal/views/mission/ ./internal/protocol/` (the Go suite must stay green: it ignores the new fields). Expected: PASS.

- [ ] **Step 8: Commit** `git add lib/ui lib/mission ui/fixtures`, message `glitter: stash intents, the switch prompt, and stash state on the wire`.

---

### Task 5: The stash view (gated on Task 1's sign-off)

**Files:**
- Create: `ui/internal/views/mission/stash.go`, `ui/internal/views/mission/stash_test.go`
- Modify: `ui/internal/views/mission/model.go`, `history.go`, `mission.go`, `changes.go`, `diff.go`, `ui/internal/theme/theme.go`, the Go tests that read `StashCount` (`model_test.go`, `mission_test.go`, `render_test.go`), `lib/ui/protocol.ts`, `lib/mission/model.ts`, `lib/mission/driver.ts`, `lib/ui/__tests__/protocol.test.ts`, both fixtures

**Interfaces:**
- Consumes: Task 4's wire; the approved `Stash.png`.
- Produces: `StashModel`, `SwitchPrompt`, `Model.Stash`, `Model.SwitchPrompt`, `Model.CanStash`; `focusStashFiles`; `committedPane`, `(*Mission).renderCommittedPane`, `(*Mission).committedPaneHit`; `(*Mission).stashShowing() bool`; `(*Mission).toggleStash() tea.Cmd`; `stashHeaderButtons(width int) (restoreStart, restoreEnd, discardStart, discardEnd int)`; hit kinds `hitStashFile`, `hitStashRestore`, `hitStashDiscard`.

- [ ] **Step 1: Remove `stashCount` end to end.** Delete `stashCount` from `MissionModel` (`protocol.ts`), the `stashes` input and output of `buildModel`, the driver's `stashCount` field and the `client.stashes()` call in `refresh()`, both fixtures, and `protocol.test.ts`'s `stashCount` assertion. In Go, replace `StashCount int` in `model.go` with:

```go
type StashModel struct {
	Sha          string           `json:"sha"`
	Branch       string           `json:"branch"`
	Files        []HistoryFileRow `json:"files"`
	Showing      bool             `json:"showing"`
	SelectedFile string           `json:"selectedFile"`
}

// SwitchPrompt is one-shot on the wire: the view opens the question for a
// Seq it has not seen and never reopens one.
type SwitchPrompt struct {
	Seq      int    `json:"seq"`
	Branch   string `json:"branch"`
	Current  string `json:"current"`
	HasStash bool   `json:"hasStash"`
}
```

  and in `Model`: `Stash *StashModel \`json:"stash"\``, `SwitchPrompt *SwitchPrompt \`json:"switchPrompt"\``, `CanStash bool \`json:"canStash"\``. Update every Go test that set or read `StashCount` to set `Stash: &StashModel{Sha: "s1", Branch: "main", Files: []HistoryFileRow{}}` instead (and the inline JSON models in `mission_test.go` to `"stash":null`), and set the fixture's `stash` to a one-file entry so `TestFixtureDecodes`-style assertions still cover the strip (`model_test.go`'s `StashCount != 1` becomes `Stash == nil || Stash.Branch != "main"`).

- [ ] **Step 2: Lift History's right pane.** In `history.go`, turn `renderHistoryPane`'s body (after the slate check), `renderHistoryFiles`, and `historyPaneHit`'s geometry into a shared renderer; History keeps its slate and expander, and every existing History test must pass unchanged:

```go
// committedPane is History.png's right pane: a header, a rule, then a file
// column beside the read-only diff. History and the stash view both paint
// through it, and committedPaneHit reads the same geometry.
type committedPane struct {
	header  []string
	files   []HistoryFileRow
	cursor  string
	top     *int
	hover   int
	focused bool
}

type paneRegion int

const (
	paneNone paneRegion = iota
	paneHeader
	paneFile
	paneDiff
)

type paneHit struct {
	region paneRegion
	row    int
	idx    int
	diff   hit
}

func (m *Mission) renderCommittedPane(p committedPane, width, height int) string {
	filesW := historyFilesWidth(width)
	diffW := max(width-filesW-1, 0)
	bodyH := max(height-len(p.header)-1, 0)
	ruleOn := lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Rule)
	rows := append(append([]string{}, p.header...), ruleOn.Render(strings.Repeat("─", filesW)+"┬"+strings.Repeat("─", diffW)))
	if bodyH > 0 {
		divider := strings.TrimSuffix(strings.Repeat(ruleOn.Render("│")+"\n", bodyH), "\n")
		rows = append(rows, lipgloss.JoinHorizontal(lipgloss.Top, m.renderCommittedFiles(p, filesW, bodyH), divider, m.renderDiffPane(diffW, bodyH)))
	}
	return strings.Join(rows, "\n")
}

func (m *Mission) renderCommittedFiles(p committedPane, width, height int) string {
	on := lipgloss.NewStyle().Background(theme.Bg)
	noun := "files"
	if len(p.files) == 1 {
		noun = "file"
	}
	lines := []string{on.Width(width).Foreground(theme.Dim).Render(clip(fmt.Sprintf(" %d changed %s", len(p.files), noun), width))}
	cursorIdx := -1
	for i, f := range p.files {
		if f.Path == p.cursor {
			cursorIdx = i
		}
	}
	listH := height - 1
	rowW := max(width-1, 0)
	top, vis := picker.Viewport(max(cursorIdx, 0), *p.top, len(p.files), listH, listH, 0)
	*p.top = top
	thumbTop, thumbH := picker.ThumbSpan(top, vis, len(p.files))
	thumbOn := lipgloss.NewStyle().Background(theme.Panel)
	for i := 0; i < listH; i++ {
		idx := top + i
		line := on.Width(rowW).Render("")
		if i < vis && idx < len(p.files) {
			line = renderHistoryFileRow(p.files[idx], rowW, idx == cursorIdx, idx == p.hover, p.focused)
		}
		lines = append(lines, line+picker.ThumbCell(i, thumbTop, thumbH, thumbOn, on))
	}
	return strings.Join(lines, "\n")
}

func (m *Mission) committedPaneHit(p committedPane, x, y, paneW int) paneHit {
	headerH := len(p.header)
	filesW := historyFilesWidth(paneW)
	switch {
	case y < headerH:
		return paneHit{region: paneHeader, row: y}
	case y == headerH:
		return paneHit{}
	}
	bodyY := y - headerH - 1
	switch {
	case x < filesW:
		if bodyY == 0 {
			return paneHit{}
		}
		if idx := *p.top + bodyY - 1; idx < len(p.files) {
			return paneHit{region: paneFile, idx: idx}
		}
		return paneHit{}
	case x == filesW:
		return paneHit{}
	}
	return paneHit{region: paneDiff, diff: m.diffHit(x-filesW-1, bodyY, max(paneW-filesW-1, 0))}
}

func (m *Mission) historyPane(width, height int) committedPane {
	return committedPane{
		header: m.historyHeader(width, height), files: m.model.History.Files, cursor: m.historyFile,
		top: &m.historyFilesTop, hover: m.hoverHistoryFile, focused: m.focus == focusHistoryFiles,
	}
}
```

  `renderHistoryPane` becomes the slate check plus `m.renderCommittedPane(m.historyPane(width, height), width, height)`; `renderHistoryFiles` is deleted; `historyPaneHit` maps `committedPaneHit(m.historyPane(paneW, m.layout().bodyH), x, y, paneW)`: header row 0 with `RangeCount <= 1` to `hitHistoryExpander`, `paneFile` to `hitHistoryFile`, `paneDiff` to its `diff` hit. `historyWheel` uses `len(m.historyPane(...).header)` for the header height. Run `go test ./internal/views/mission/` now: every History test passes before any stash code exists. Commit this lift on its own: `git add ui/internal/views/mission/history.go`, message `glitter: lift History's right pane into a shared committed pane`.

- [ ] **Step 3: Write the failing stash view tests** in `stash_test.go` (reuse `newTestMission`, `newMouseTestMission`, `pushModel`/`SetModel` helpers already in the package; set the frame size the way `render_test.go` does):

```go
package mission

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/theme"
)

func stashMission(showing bool) *Mission {
	m := newTestMission()
	m.width, m.height = 150, 40
	m.model.Stash = &StashModel{
		Sha: "s1", Branch: "main", Showing: showing, SelectedFile: "a.txt",
		Files: []HistoryFileRow{{Path: "a.txt", Status: "modified"}, {Path: "b.txt", Status: "new"}},
	}
	if showing {
		m.model.Diff = DiffModel{Path: "a.txt", Status: "modified", Kind: "text", ReadOnly: true}
		m.focus = focusStashFiles
		m.stashFile = "a.txt"
	}
	return m
}

func TestStashStripShowsOnlyWithAnEntry(t *testing.T) {
	m := stashMission(false)
	if out := ansi.Strip(m.View().Content); !strings.Contains(out, "Stashed Changes") {
		t.Fatalf("strip missing:\n%s", out)
	}
	m.model.Stash = nil
	if out := ansi.Strip(m.View().Content); strings.Contains(out, "Stashed Changes") {
		t.Fatalf("strip painted without an entry:\n%s", out)
	}
}

func TestStashStripPaintsSelectedWhileShowing(t *testing.T) {
	rest := renderStashStrip(false, false, sidebarWidth)
	sel := renderStashStrip(true, false, sidebarWidth)
	if rest == sel || !strings.Contains(sel, bgSGR(theme.SelBg)) {
		t.Fatalf("selected strip should paint SelBg")
	}
}

func TestStashViewPaintsHeaderFilesAndDiff(t *testing.T) {
	m := stashMission(true)
	out := ansi.Strip(m.View().Content)
	for _, want := range []string{"Stashed changes", "Restore", "Discard", "Restore will move your stashed files to the Changes list.", "2 changed files", "b.txt"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q:\n%s", want, out)
		}
	}
}

func TestStashViewLoadingMessage(t *testing.T) {
	m := stashMission(true)
	m.model.Stash.Files = nil
	if out := ansi.Strip(m.View().Content); !strings.Contains(out, "Loading stashed changes…") {
		t.Fatalf("no loading message:\n%s", out)
	}
}

func TestHTogglesTheStashView(t *testing.T) {
	m := stashMission(false)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'h', Text: "h"}); cmd == nil || m.focus != focusStashFiles {
		t.Fatalf("h should open the view and focus the stash files (focus=%v)", m.focus)
	}
	m = stashMission(true)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'h', Text: "h"}); cmd == nil || m.focus != focusList {
		t.Fatalf("h should close the view and return to the list (focus=%v)", m.focus)
	}
	m = stashMission(false)
	m.model.Stash = nil
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'h', Text: "h"}); cmd != nil {
		t.Fatalf("h without a stash does nothing")
	}
}

func TestStashFilesMoveAndEnterTheDiff(t *testing.T) {
	m := stashMission(true)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyDown}); cmd == nil || m.stashFile != "b.txt" {
		t.Fatalf("down should move to b.txt and emit (got %q)", m.stashFile)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.focus != focusDiff {
		t.Fatalf("enter should focus the diff")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.focus != focusStashFiles {
		t.Fatalf("esc from the diff returns to the stash files")
	}
}

func TestRRestoresTheStash(t *testing.T) {
	m := stashMission(true)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'R', Text: "R"}); cmd == nil {
		t.Fatalf("R should emit a restore")
	}
}

func TestStashViewClosesWhenTheEntryVanishes(t *testing.T) {
	m := stashMission(true)
	next := m.model
	next.Stash = nil
	pushModel(t, m, next)
	if m.focus != focusList {
		t.Fatalf("focus should return to the list, got %v", m.focus)
	}
}

func TestStashPaneHitsMatchPaint(t *testing.T) {
	m := stashMission(true)
	frame := ansi.Strip(m.View().Content)
	lines := strings.Split(frame, "\n")
	rs, re, ds, de := stashHeaderButtons(m.diffWidth())
	paneX := sidebarWidth + 1
	for y, line := range lines {
		if !strings.Contains(line, "Restore") || !strings.Contains(line, "Discard") {
			continue
		}
		if h := m.hitTest(paneX+rs, y); h.kind != hitStashRestore {
			t.Fatalf("Restore start hit %v", h.kind)
		}
		if h := m.hitTest(paneX+re-1, y); h.kind != hitStashRestore {
			t.Fatalf("Restore end hit %v", h.kind)
		}
		if h := m.hitTest(paneX+ds, y); h.kind != hitStashDiscard {
			t.Fatalf("Discard start hit %v", h.kind)
		}
		if h := m.hitTest(paneX+de-1, y); h.kind != hitStashDiscard {
			t.Fatalf("Discard end hit %v", h.kind)
		}
		return
	}
	t.Fatalf("no button row painted:\n%s", frame)
}

func TestEmptyStateOffersTheStash(t *testing.T) {
	out := ansi.Strip(renderEmptyStateCard(100, 20, true))
	if !strings.Contains(out, "view your stashed changes") {
		t.Fatalf("no stash hint:\n%s", out)
	}
	if strings.Contains(ansi.Strip(renderEmptyStateCard(100, 20, false)), "stashed") {
		t.Fatalf("stash hint without a stash")
	}
}
```

  `pushModel(t, m, model)` (`history_test.go`) round-trips a model through `SetModel`. Add a stash keybar test: with the view showing, `renderKeybar(150, "stash")` contains `R restore` and `h hide`.

- [ ] **Step 4: Run** `go test ./internal/views/mission/` from `ui/`. Expected: FAIL (undefined `focusStashFiles`, `stashFile`, `stashHeaderButtons`, ...).

- [ ] **Step 5: Implement** (`stash.go` holds the stash-only code; the rest are small edits):
  - `theme.go`: `GlyphStash`, the Nerd Font octicon the board chose, beside `GlyphRepo`, with the Nerd Fonts name in a trailing comment.
  - `mission.go`: `focusStashFiles` in the focus enum; fields `stashFile string`, `stashFilesTop int`, `hoverStashFile int` (initialized to -1 in `New`), `hoverStashRestore bool`, `hoverStashDiscard bool`; hit kinds `hitStashFile`, `hitStashRestore`, `hitStashDiscard`.
  - `stashShowing()`: `!m.historyTab() && m.model.Stash != nil && m.model.Stash.Showing`.
  - `SetModel`: after `m.model = decoded`, when `!m.stashShowing()` and focus is `focusStashFiles` (or `focusDiff` reached from it: track with a `diffFromStash bool` set when enter moves focus from stash files), set `focus = focusList`; when showing and `m.stashFile` is not among `Stash.Files`, set it to `Stash.SelectedFile`.
  - `toggleStash()`: nil without a stash; when showing, emit `mission:stash-hide` and set `focus = focusList`; otherwise emit `mission:stash-select {}`, set `focus = focusStashFiles`, and clear `m.stashFile` (the push supplies it).
  - `listKey`: `case "h": return m, m.toggleStash()`.
  - `Update`: route `focusStashFiles` to `stashFilesKey`: `up`/`down` move `m.stashFile` within `Stash.Files` and emit `mission:stash-select {path}` when it changed; `enter` sets `focus = focusDiff`; `h`/`esc` call `toggleStash()`; `R` emits `mission:stash-restore {sha}`; `ctrl+k` opens `m.openMenu(menuTarget{}, nil)`; `q` quits; everything else falls through to `listKey` except `space`.
  - `diffKey`: `esc` returns to `focusStashFiles` when `m.stashShowing()`; `enter` on an oversized diff emits `mission:stash-select {path, showOversized: true}` when `m.stashShowing()`.
  - `stashPane(width, height) committedPane`: header `stashHeaderLines(width, m.hoverStashRestore, m.hoverStashDiscard)`, files `Stash.Files`, cursor `m.stashFile`, top `&m.stashFilesTop`, hover `m.hoverStashFile`, focused `m.focus == focusStashFiles`.
  - `renderStashPane(width, height)`: `centeredMessage(width, height, theme.Faint, "Loading stashed changes…")` while `Stash.Files == nil`; otherwise `m.renderCommittedPane(m.stashPane(width, height), width, height)`.
  - `stashHeaderLines` and `stashHeaderButtons` paint the approved board's header: row 0 the title "Stashed changes" (the `headerRow` style History's summary uses), row 1 the Restore button, a gap, the Discard button, a gap, and the Dim explanatory line clipped to the rest. `stashHeaderButtons` is the one source of the button spans for both the painter and the hit test.
  - `View`: the right pane is `renderHistoryPane` on History, `renderStashPane` when `stashShowing()`, else `renderDiffPane`; `renderKeybar(m.width, m.keybarMode())` where `keybarMode()` is `"history"`, `"stash"` (when `stashShowing()`), or `"changes"`.
  - `changes.go`: `renderStashStrip(selected, hovered bool, width int)`: `GlyphStash + " Stashed Changes"` left and `GlyphChevron` right; SelBg when selected, HoverBg when hovered, BgSubtle at rest. `sidebarDocked` paints it when `m.model.Stash != nil` with `selected = m.stashShowing()`. `renderKeybar` gains the `"stash"` pairs `{"↑↓","files"}, {"enter","diff"}, {"R","restore"}, {"h","hide"}, {"⌃k","menu"}, {"b","branch"}, {"w","worktree"}, {"r","repo"}` (Task 6 adds `D`).
  - `diff.go`: `renderEmptyStateCard(width, height int, hasStash bool)` appends `hint("h", "view your stashed changes")` when `hasStash`; its caller passes `m.model.Stash != nil`.
  - Mouse: `hitTest`'s diff-pane branch routes through `committedPaneHit(m.stashPane(...), ...)` when `stashShowing()`: header row 1 inside a button span gives `hitStashRestore`/`hitStashDiscard`, `paneFile` gives `hitStashFile`, `paneDiff` its diff hit. `mouseClick`: `hitStash` calls `toggleStash()` (replacing the "lands in v2" notice), `hitStashFile` selects that file (focus `focusStashFiles`, emit when changed), `hitStashRestore` emits the restore. `setHover` sets `hoverStashFile`/`hoverStashRestore`/`hoverStashDiscard` and clears them with the others. The wheel over the stash file column moves the file cursor; over its diff, the diff cursor (mirror `historyWheel`).

- [ ] **Step 6: Run** from `ui/`: `go test ./internal/views/picker/ ./internal/views/mission/ ./internal/protocol/`; from the root: `bun test lib/mission`, `bun test lib/ui`, `bunx tsc --noEmit`; then `bun run ui:build`. Expected: PASS.

- [ ] **Step 7: Commit** `git add ui/internal lib/ui lib/mission ui/fixtures`, message `glitter: Stashed Changes strip and view`.

---

### Task 6: Stash dialogs, the list menu, and the switch prompt (gated on Task 1's sign-off)

**Files:**
- Modify: `ui/internal/views/mission/stash.go`, `menu.go`, `mission.go`, `changes.go`, `ui/internal/views/mission/menu_test.go`, `stash_test.go`

**Interfaces:**
- Consumes: Task 5's view state; Task 4's intents; `picker.Menu` (`NewMenu`, `Push`, `FitParentHeight`, disabled and quiet rows).
- Produces: `targetChangesList`, `targetStash`, `targetSwitch` target kinds; `hitMasterRow`; `(*Mission).openQuestion(title string, items []picker.MenuItem, t menuTarget)`; `m.switchSeq int`.

- [ ] **Step 1: Write the failing tests** in `menu_test.go` / `stash_test.go` (the `labels` helper already exists in `menu_test.go`):

```go
func TestChangesListMenuIsGitHubDesktops(t *testing.T) {
	m := newMouseTestMission()
	m.model.ChangedTotal = 3
	m.model.CanStash = true
	_, items := m.menuItems(menuTarget{kind: targetChangesList})
	got := labels(items)[:2]
	if strings.Join(got, "|") != "Discard All Changes…|Stash All Changes" {
		t.Fatalf("rows %q", got)
	}
	m.model.Stash = &StashModel{Sha: "s1", Branch: "main"}
	_, items = m.menuItems(menuTarget{kind: targetChangesList})
	if items[1].Label != "Stash All Changes…" {
		t.Fatalf("with a stash the row asks first: %q", items[1].Label)
	}
	m.model.CanStash = false
	m.model.ChangedTotal = 0
	_, items = m.menuItems(menuTarget{kind: targetChangesList})
	if !items[0].Disabled || !items[1].Disabled {
		t.Fatalf("both rows grey with no changes")
	}
}

func TestBoardSectionListsStashKeys(t *testing.T) {
	m := newMouseTestMission()
	m.model.CanStash = true
	got := strings.Join(labels(m.boardItems()), "|")
	for _, want := range []string{"Stash All Changes", "Show Stashed Changes (disabled)"} {
		if !strings.Contains(got, want) {
			t.Fatalf("board rows %q missing %q", got, want)
		}
	}
	m.model.Stash = &StashModel{Sha: "s1", Branch: "main", Showing: true}
	if got := strings.Join(labels(m.boardItems()), "|"); !strings.Contains(got, "Hide Stashed Changes") {
		t.Fatalf("board rows %q", got)
	}
}

func TestShiftSStashesOrAsksToOverwrite(t *testing.T) {
	m := newMouseTestMission()
	m.model.CanStash = true
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'S', Text: "S"}); cmd == nil || m.menu != nil {
		t.Fatalf("S without a stash emits at once")
	}
	m.model.Stash = &StashModel{Sha: "s1", Branch: "main"}
	m.Update(tea.KeyPressMsg{Code: 'S', Text: "S"})
	if m.menu == nil || m.menu.Title() != "Overwrite Stash?" {
		t.Fatalf("S with a stash asks Overwrite Stash?")
	}
	m = newMouseTestMission()
	m.model.CanStash = false
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'S', Text: "S"}); cmd != nil || m.menu != nil {
		t.Fatalf("S does nothing when stashing is disabled")
	}
}

func TestDAsksDiscardStash(t *testing.T) {
	m := stashMission(true)
	m.Update(tea.KeyPressMsg{Code: 'D', Text: "D"})
	if m.menu == nil || m.menu.Title() != "Discard Stash?" {
		t.Fatalf("D should ask Discard Stash?")
	}
	out := ansi.Strip(m.View().Content)
	if !strings.Contains(out, "Are you sure you want to discard these stashed changes?") {
		t.Fatalf("body missing:\n%s", out)
	}
}

func TestSwitchPromptOpensOncePerSeq(t *testing.T) {
	m := newMouseTestMission()
	next := m.model
	next.SwitchPrompt = &SwitchPrompt{Seq: 1, Branch: "other", Current: "main", HasStash: true}
	pushModel(t, m, next)
	if m.menu == nil || m.menu.Title() != "Switch Branch" {
		t.Fatalf("prompt should open Switch Branch")
	}
	out := ansi.Strip(m.View().Content)
	for _, want := range []string{
		"You have changes on this branch. What would you like to do with them?",
		"Leave my changes on main",
		"Your in-progress work will be stashed on this branch for you to return to later",
		"Your current stash will be overwritten by creating a new stash",
		"Bring my changes to other",
		"Your in-progress work will follow you to the new branch",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q:\n%s", want, out)
		}
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	pushModel(t, m, next)
	if m.menu != nil {
		t.Fatalf("a seen seq must not reopen")
	}
}

func TestSwitchLeaveWithAStashAsksToOverwrite(t *testing.T) {
	m := newMouseTestMission()
	next := m.model
	next.SwitchPrompt = &SwitchPrompt{Seq: 1, Branch: "other", Current: "main", HasStash: true}
	pushModel(t, m, next)
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.menu == nil || m.menu.Title() != "Overwrite Stash?" {
		t.Fatalf("Leave with a stash goes to Overwrite Stash?")
	}
}

func TestSwitchBringEmitsAtOnce(t *testing.T) {
	m := newMouseTestMission()
	next := m.model
	next.SwitchPrompt = &SwitchPrompt{Seq: 1, Branch: "other", Current: "main"}
	pushModel(t, m, next)
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatalf("Bring should close the question and emit")
	}
}

func TestRightClickOnTheChangedFilesRowOpensTheListMenu(t *testing.T) {
	m := newMouseTestMission()
	m.model.ChangedTotal = 2
	y := masterRowFrameY(m)
	m.Update(tea.MouseClickMsg{X: 5, Y: y, Button: tea.MouseRight})
	if m.menu == nil || m.menuTarget.kind != targetChangesList {
		t.Fatalf("right-click on the header row should open the list menu")
	}
}
```

  `masterRowFrameY` is the frame row of `renderMasterRow` (top bar height plus `sidebarFixedTopRows - 1`); write it beside `changesRowY` from the same arithmetic. Payload assertions go in `mission_test.go`'s session tests through the real binary (`openMission`, `sgrClick`), as the context-menu tests do: `S` emits `mission:stash`; the switch prompt's Bring emits `mission:checkout {"branch":"other","strategy":"bring"}`; Overwrite after Leave emits `strategy: "leave"`; Discard Stash's confirm emits `mission:stash-discard {"sha":"s1"}`; Discard All's confirm emits `mission:menu-action {"action":"discard-all"}`.

- [ ] **Step 2: Run** `go test ./internal/views/mission/` from `ui/`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `openQuestion(title, items, t)`: `picker.NewMenu(title, items, nil)` (centered), `FitParentHeight()`, blur the commit inputs, close any open foldout (`m.modal = nil`), save `menuPrevFocus`, set `menuTarget = t`, `focus = focusMenu`. Body lines are `picker.MenuItem{ID: "body", Label: text, Disabled: true, Section: 0}`; choices are `Section: 1`.
  - Questions (ids are view-local):
    - **Overwrite Stash?**: body "Are you sure you want to proceed? This will overwrite your existing stash with your current changes."; rows `overwrite` "Overwrite", `cancel` "Cancel". Its target remembers what confirmed it: `targetStash` (from Stash All Changes: emit `mission:stash {}`) or `targetSwitch` (from Leave: emit `mission:checkout {branch, strategy: "leave"}`). Reached from a root question with `m.menu.Push`, from a key with `openQuestion`.
    - **Discard Stash?**: body "Are you sure you want to discard these stashed changes?"; rows `stash-discard` "Discard", `cancel` "Cancel"; confirm emits `mission:stash-discard {sha}`.
    - **Discard All Changes**: title "Discard all changes to <basename>?" for one file, else "Discard all <N> changed files?" (N is `ChangedTotal`); rows `discard-all-confirm` "Discard All Changes", `cancel` "Cancel"; confirm emits `mission:menu-action {"action":"discard-all"}`.
    - **Switch Branch**: body "You have changes on this branch. What would you like to do with them?" (Section 0); Section 1: `switch-leave` "Leave my changes on <Current>", a disabled "Your in-progress work will be stashed on this branch for you to return to later", when `HasStash` a disabled `theme.GlyphWarn + " Your current stash will be overwritten by creating a new stash"`, `switch-bring` "Bring my changes to <Branch>", a disabled "Your in-progress work will follow you to the new branch". Leave with `HasStash` pushes Overwrite Stash?; Leave without, or Bring, closes and emits `mission:checkout {branch, strategy}`.
  - `cancel` closes the menu. `runMenuItem` handles every id above.
  - `SetModel`: when `decoded.SwitchPrompt != nil && decoded.SwitchPrompt.Seq > m.switchSeq`, set `m.switchSeq` and open Switch Branch with a `targetSwitch` target carrying the prompt.
  - `menuItems(targetChangesList)`: title "Changes"; rows `discard-all` "Discard All Changes…" (disabled when `ChangedTotal == 0`) and `stash-all` "Stash All Changes" or "Stash All Changes…" when `Stash != nil` (disabled when `!CanStash`), both Section 0, then the board rows. `discard-all` pushes the Discard All question; `stash-all` pushes Overwrite Stash? when `Stash != nil`, else closes and emits `mission:stash {}`.
  - `menuItems` for a stash-view ctrl-k (`targetNone` while `stashShowing()`): title "Stashed Changes"; rows `stash-restore` "Restore" and `stash-discard-ask` "Discard…" (Section 0), then the board rows.
  - `boardItems` on the Changes tab gains `key("S", <"Stash All Changes" or "Stash All Changes…">)` disabled when `!CanStash`, and `key("h", <"Show Stashed Changes" or "Hide Stashed Changes" when showing>)` disabled when `Stash == nil`; keep the existing order and add these two after "Filter".
  - `listKey` and `stashFilesKey`: `case "S"`: nothing when `!CanStash`; `openQuestion("Overwrite Stash?", …, targetStash)` when `Stash != nil`; else emit `mission:stash {}`. `stashFilesKey`: `case "D"`: `openQuestion("Discard Stash?", …, targetStash)`.
  - Mouse: `hitMasterRow` for the "N changed files" row in `sidebarHit`; a right-click on it opens `menuTarget{kind: targetChangesList}` anchored at the pointer. A left-click on `hitStashDiscard` opens Discard Stash?.
  - Keybar `"stash"` pairs gain `{"D", "discard"}` after `R`.

- [ ] **Step 4: Run** from `ui/`: `go test ./internal/views/picker/ ./internal/views/mission/ ./internal/protocol/`; `bun run ui:build`. Expected: PASS.

- [ ] **Step 5: Commit** `git add ui/internal`, message `glitter: stash dialogs, the Changes list menu, and Desktop's switch prompt`.

---

### Task 7: pty gate, docs, and the live check

**Files:**
- Modify: `e2e/pty/glitter.test.ts`, `docs/design/mission/README.md`

- [ ] **Step 1: Write the pty test** beside the ctrl-k test: `openBoard()`, press `S`, wait for "Stashed Changes"; assert through git that `git log -g --format=%gs refs/stash --` has exactly one line containing `!!GitHub_Desktop<` and `git status --porcelain` is empty; press `h`, wait for "Restore will move your stashed files"; press `R`, wait for "Commit 4 files"; assert through git that the stash list is empty and `git status --porcelain` lists the sandbox's four changes again.

- [ ] **Step 2: Run** `bun run test:pty`. Expected: PASS locally (CI's glitter-pty job is broken on main by the socket-path length regression; note that in the PR, do not fix it here).

- [ ] **Step 3: README.** In `docs/design/mission/README.md`: list `Stash.png` and `StashStates.png` under Boards; add a "Stash: GitHub Desktop's one-stash-per-branch model" section (the marker and interop with GitHub Desktop, the strip, the view, the dialogs, leave versus bring, the store owning the view state); remove the "Stash foldout" line from "Deferred to v2"; rewrite the guarded-checkout deviation to "A branch checked out in another worktree is refused; GitHub Desktop switches to that worktree instead."; add deviations: `S` and `h` stand in for ⌘⇧S and Ctrl+H; Discard Stash? always asks (no "Do not show this message again"); Switch Branch shows both descriptions and the overwrite warning as rows; there is no always-leave or always-bring setting. Add the stash keybar to the keybar rows.

- [ ] **Step 4: Commit** `git add e2e/pty/glitter.test.ts docs/design/mission/README.md`, message `glitter: pty gate stashes and restores; design README documents stash`.

- [ ] **Step 5 (controller): Live check.** Run glitter from this worktree in tmux against a scratch repo with changes, and capture every board state: the strip at rest, hovered, and selected; the stash view with a cursor file and its diff; each dialog (Switch Branch with and without a stash, Overwrite Stash?, Discard Stash?, Discard All Changes); the list menu enabled and greyed; ctrl-k's board rows; the empty-state line. Compare each with `Stash.png`/`StashStates.png` for tokens and composition, fix what reads wrong, then hand Matt the test-drive command.
