# git-core Mutations (Chunk 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the mutation layer to `packages/git-core`: line/hunk staging and discard via GitHub Desktop's vendored MIT patch pipeline, commit ergonomics, undo/reset, stash and tag mutations, guarded branch ops, plus the RT-188 hardening items.

**Architecture:** GHD's `diff-parser.ts` + `DiffSelection` + `patch-formatter.ts` are vendored verbatim into `src/vendor/ghd/` and fed raw `git diff` text, so the formatter operates on exactly the model it was written for (no model conversion). Our code is limited to a thin apply layer (`git apply --cached --unidiff-zero --whitespace=nowarn -` with the patch on stdin) and simple-git wrappers for commit/stash/tag/branch verbs. Stack and worktree ownership guards compose in rt's `lib/` layer, never inside git-core.

**Tech Stack:** Bun, TypeScript, simple-git (already a dep), vendored GHD code (MIT). No new npm dependencies.

**Spec:** Linear RT-189 (https://linear.app/mattstack/issue/RT-189) plus its hardening comment; project "Headless git client + mission control" carries the standing rulings. The GHD vendor-surface report from the explore agent is summarized inline where each task needs it.

## Global Constraints

- This repo is public. Run `scripts/repo-purity.sh` before any push. No Linear ticket ids (RT-*) in code, comments, or test names.
- Vendored files under `packages/git-core/src/vendor/ghd/` keep upstream comments and structure verbatim. Permitted edits ONLY: import-path adjustments, deleting the one `log.debug` call, narrowing two type signatures as specified in Task 3, and inlining two pure helper functions as specified in Task 2. `vendor/ghd/LICENSE` (GHD's MIT text) and `vendor/ghd/README.md` (provenance) are mandatory.
- Upstream source of truth: local clone `/Users/matt/Documents/GitHub/github-desktop` at commit 9dfe6e60. Record that commit in the vendor README.
- No em dashes or en dashes anywhere (code, comments, commit messages). Use "..." or rephrase.
- Never use the `@{u}` / `@{upstream}` shorthand. Resolve upstream ref names explicitly (from `for-each-ref` output) and pass them literally.
- Authored (non-vendored) code follows the clean-code comment rule: comments only for constraints the code cannot show.
- `packages/git-core` stays `private: true`, source-only, no build step, no CLI/tree/daemon changes. `cli.ts`, `lib/module-registry.ts`, `lib/command-tree-def.ts` are untouched by this plan.
- Every mutation verb gets conformance coverage against real sandbox repos (`test-support/sandbox.ts`).
- Shell in this worktree is guarded: one plain command per Bash call, no `&&`, no heredocs, no `git -C`. To run package scripts: `cd packages/git-core` then `bun test src` (or `bun run check-types`) as separate calls.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
packages/git-core/src/vendor/ghd/
  LICENSE            (GHD MIT text, verbatim)
  README.md          (provenance: repo, commit, per-file source paths, edits made)
  diff-line.ts       (upstream app/src/models/diff/diff-line.ts, verbatim)
  raw-diff.ts        (upstream app/src/models/diff/raw-diff.ts, verbatim)
  fatal-error.ts     (assertNever only, from app/src/lib/fatal-error.ts)
  diff-selection.ts  (upstream app/src/models/diff/diff-selection.ts, verbatim)
  support.ts         (two pure helpers inlined from upstream UI files)
  diff-parser.ts     (upstream app/src/lib/diff-parser.ts, imports redirected)
  types.ts           (AppFileStatusKind enum + narrowed structural param types)
  patch-formatter.ts (upstream app/src/lib/patch-formatter.ts, minus log.debug)
packages/git-core/src/
  exec.ts        (extend: stdin option, rawGitOk)
  staging.ts     (NEW: stagingDiff / stageSelection / discardSelection)
  commits.ts     (NEW: undoLastCommit / resetToCommit)
  stash.ts       (extend: stashPush / stashApply / stashPop / stashDrop)
  branch-ops.ts  (NEW: checkoutBranch / createBranch)
  refs.ts        (extend: createTag / deleteTag / pushTag, TagInfo.targetSha)
  diff.ts        (hardening: classifier fixes, untracked hint)
  log.ts         (hardening: NUL splitter)
  client.ts      (wire new verbs; LC_ALL=C env)
  types.ts       (new verb signatures, FetchState ISO string)
lib/commit-ops.ts             (extend commitStaged with CommitOpts)
lib/branch-guard.ts           (NEW: rt-side composition of stack-guard + worktree ownership)
lib/__tests__/commit-ops.test.ts   (extend)
lib/__tests__/branch-guard.test.ts (NEW)
```

Task order matters for 1 to 4 (vendor chain), 5 onward are independent.

---

### Task 1: Vendor the GHD diff models + DiffSelection, with a fresh DiffSelection suite

**Files:**
- Create: `packages/git-core/src/vendor/ghd/LICENSE`
- Create: `packages/git-core/src/vendor/ghd/README.md`
- Create: `packages/git-core/src/vendor/ghd/diff-line.ts`
- Create: `packages/git-core/src/vendor/ghd/raw-diff.ts`
- Create: `packages/git-core/src/vendor/ghd/fatal-error.ts`
- Create: `packages/git-core/src/vendor/ghd/diff-selection.ts`
- Test: `packages/git-core/src/__tests__/diff-selection.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DiffLine`, `DiffLineType` (numeric enum Context/Add/Delete/Hunk), `DiffHunk`, `DiffHunkHeader`, `DiffHunkExpansionType`, `IRawDiff` (from raw-diff.ts), `DiffSelection`, `DiffSelectionType` (from diff-selection.ts), `assertNever` (from fatal-error.ts). Tasks 2-4 import these.

- [ ] **Step 1: Copy the four source files**

Copy verbatim from the GHD clone:

| Vendor file | Upstream source |
|---|---|
| `diff-line.ts` | `/Users/matt/Documents/GitHub/github-desktop/app/src/models/diff/diff-line.ts` |
| `raw-diff.ts` | `/Users/matt/Documents/GitHub/github-desktop/app/src/models/diff/raw-diff.ts` |
| `diff-selection.ts` | `/Users/matt/Documents/GitHub/github-desktop/app/src/models/diff/diff-selection.ts` |
| `LICENSE` | `/Users/matt/Documents/GitHub/github-desktop/LICENSE` |

Then the only edits:
- `raw-diff.ts`: its import of diff-line becomes `./diff-line` (check upstream path; it already imports `./diff-line`, so likely no edit needed).
- `diff-selection.ts`: change `import { assertNever } from '../../lib/fatal-error'` to `from './fatal-error'`.

- [ ] **Step 2: Write `fatal-error.ts` (trimmed)**

```ts
/**
 * Trimmed from github-desktop app/src/lib/fatal-error.ts (MIT, see LICENSE).
 * Only assertNever is vendored; the fatalError machinery is Electron-specific.
 */
export function assertNever(_x: never, message: string): never {
  throw new Error(message)
}
```

- [ ] **Step 3: Write `README.md` (provenance)**

Content: source repo `https://github.com/desktop/desktop`, local clone commit `9dfe6e60`, MIT license (see LICENSE), a table mapping each vendor file to its upstream path, and a complete list of the edits made (import paths, deleted `log.debug`, narrowed signatures in patch-formatter.ts, inlined helpers in support.ts). Update this table in Tasks 2 and 3 as those files land.

- [ ] **Step 4: Write the failing DiffSelection suite**

Upstream has NO dedicated DiffSelection test (verified against desktop/desktop@development); this suite is ours and pins the index arithmetic the whole staging feature depends on. `packages/git-core/src/__tests__/diff-selection.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  DiffSelection,
  DiffSelectionType,
} from "../vendor/ghd/diff-selection.ts";

describe("DiffSelection", () => {
  test("fromInitialSelection(All) reports All and selects any line", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.All);
    expect(s.getSelectionType()).toBe(DiffSelectionType.All);
    expect(s.isSelected(0)).toBe(true);
    expect(s.isSelected(41)).toBe(true);
  });

  test("fromInitialSelection(None) reports None and selects nothing", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.None);
    expect(s.getSelectionType()).toBe(DiffSelectionType.None);
    expect(s.isSelected(7)).toBe(false);
  });

  test("withLineSelection diverges a single line to Partial", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.All)
      .withLineSelection(3, false);
    expect(s.getSelectionType()).toBe(DiffSelectionType.Partial);
    expect(s.isSelected(3)).toBe(false);
    expect(s.isSelected(2)).toBe(true);
  });

  test("withToggleLineSelection twice restores the original state", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.All)
      .withToggleLineSelection(5)
      .withToggleLineSelection(5);
    expect(s.getSelectionType()).toBe(DiffSelectionType.All);
  });

  test("withRangeSelection selects [from, from+length)", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.None)
      .withRangeSelection(10, 3, true);
    expect(s.isSelected(9)).toBe(false);
    expect(s.isSelected(10)).toBe(true);
    expect(s.isSelected(12)).toBe(true);
    expect(s.isSelected(13)).toBe(false);
    expect(s.isRangeSelected(10, 3)).toBe(DiffSelectionType.All);
    expect(s.isRangeSelected(9, 3)).toBe(DiffSelectionType.Partial);
    expect(s.isRangeSelected(20, 2)).toBe(DiffSelectionType.None);
  });

  test("withSelectAll / withSelectNone collapse divergence", () => {
    const base = DiffSelection.fromInitialSelection(DiffSelectionType.All)
      .withLineSelection(1, false);
    expect(base.withSelectAll().getSelectionType()).toBe(DiffSelectionType.All);
    expect(base.withSelectNone().getSelectionType()).toBe(DiffSelectionType.None);
  });

  test("withSelectableLines: deselecting every selectable line reads as None", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.All)
      .withSelectableLines(new Set([2, 4]))
      .withLineSelection(2, false)
      .withLineSelection(4, false);
    expect(s.getSelectionType()).toBe(DiffSelectionType.None);
  });

  test("withSelectableLines: isSelectable gates non-listed indices", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.All)
      .withSelectableLines(new Set([2, 4]));
    expect(s.isSelectable(2)).toBe(true);
    expect(s.isSelectable(3)).toBe(false);
  });

  test("selection is immutable: with* returns a new object", () => {
    const a = DiffSelection.fromInitialSelection(DiffSelectionType.All);
    const b = a.withLineSelection(0, false);
    expect(a.isSelected(0)).toBe(true);
    expect(b.isSelected(0)).toBe(false);
  });
});
```

- [ ] **Step 5: Run and fix imports until green**

Run: `cd packages/git-core` then `bun test src/__tests__/diff-selection.test.ts`
Expected: all pass (the vendored class is battle-tested; failures indicate a botched copy or import edit, not a code bug to fix in place).

Also run: `bun run check-types` (from `packages/git-core`). The vendored files must type-check under this repo's tsconfig; if `strict` surfaces errors, prefer minimal tsconfig-level accommodation for the vendor dir (e.g. an `// @ts-expect-error` is NOT acceptable inside vendored bodies; instead adjust `types.ts` shims in later tasks or add the narrowest possible compiler exception and record it in the vendor README).

- [ ] **Step 6: Commit**

```bash
git add packages/git-core/src/vendor packages/git-core/src/__tests__/diff-selection.test.ts
git commit -m "git-core: vendor GHD diff models + DiffSelection (MIT)"
```

---

### Task 2: Vendor diff-parser + inlined pure helpers, pinned by golden tests

**Files:**
- Create: `packages/git-core/src/vendor/ghd/support.ts`
- Create: `packages/git-core/src/vendor/ghd/diff-parser.ts`
- Modify: `packages/git-core/src/vendor/ghd/README.md` (provenance rows)
- Test: `packages/git-core/src/__tests__/vendor-diff-parser.test.ts`

**Interfaces:**
- Consumes: Task 1 models.
- Produces: `class DiffParser { parse(text: string): IRawDiff }`. Task 3 tests and Task 4 staging use it. `IRawDiff.hunks: ReadonlyArray<DiffHunk>` where each hunk's `lines[0]` is the synthetic Hunk-type header line, every `DiffLine.text` carries its `+`/`-`/space prefix, and `unifiedDiffStart/End` form a diff-global running counter.

- [ ] **Step 1: Copy `diff-parser.ts`**

From `/Users/matt/Documents/GitHub/github-desktop/app/src/lib/diff-parser.ts` (461 lines). Edits:
- Model imports point at `./raw-diff` / `./diff-line`.
- Its two UI imports are replaced by `./support`:
  - `getHunkHeaderExpansionType` (upstream `app/src/ui/diff/text-diff-expansion.ts` lines ~88-118, a pure function)
  - `getLargestLineNumber` (upstream `app/src/ui/diff/diff-helpers.tsx`, one pure function; copy only the function, never the file, which imports React)

- [ ] **Step 2: Write `support.ts`**

Copy both functions verbatim from their upstream files with a header comment naming each source path. No other content.

- [ ] **Step 3: Write the failing golden tests**

`packages/git-core/src/__tests__/vendor-diff-parser.test.ts`. Reuse the chunk-1 golden diff inputs (see `src/__tests__/diff.test.ts` for the exact strings used there) and pin the four properties Task 4 depends on:

```ts
import { describe, expect, test } from "bun:test";
import { DiffParser } from "../vendor/ghd/diff-parser.ts";
import { DiffLineType } from "../vendor/ghd/diff-line.ts";

const BASIC = [
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,3 +1,3 @@",
  " one",
  "-two",
  "+deux",
  " three",
  "",
].join("\n");

describe("vendored DiffParser", () => {
  test("hunk lines[0] is the synthetic @@ header line", () => {
    const d = new DiffParser().parse(BASIC);
    expect(d.hunks).toHaveLength(1);
    const h = d.hunks[0]!;
    expect(h.lines[0]!.type).toBe(DiffLineType.Hunk);
    expect(h.lines[0]!.text).toBe("@@ -1,3 +1,3 @@");
  });

  test("line text carries the prefix character", () => {
    const h = new DiffParser().parse(BASIC).hunks[0]!;
    expect(h.lines[1]!.text).toBe(" one");
    expect(h.lines[2]!.text).toBe("-two");
    expect(h.lines[3]!.text).toBe("+deux");
    expect(h.lines[2]!.content).toBe("two");
  });

  test("unifiedDiffStart chains as a diff-global counter", () => {
    const TWO_HUNKS = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+deux",
      " three",
      "@@ -10,3 +10,3 @@",
      " ten",
      "-eleven",
      "+onze",
      " twelve",
      "",
    ].join("\n");
    const d = new DiffParser().parse(TWO_HUNKS);
    const [h1, h2] = [d.hunks[0]!, d.hunks[1]!];
    expect(h1.unifiedDiffStart).toBe(0);
    expect(h1.unifiedDiffEnd).toBe(h1.unifiedDiffStart + h1.lines.length - 1);
    expect(h2.unifiedDiffStart).toBe(h1.unifiedDiffStart + h1.lines.length);
  });

  test("no-newline marker sets noTrailingNewLine on the preceding line", () => {
    const NO_NL = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    const h = new DiffParser().parse(NO_NL).hunks[0]!;
    const added = h.lines.find((l) => l.type === DiffLineType.Add)!;
    expect(added.noTrailingNewLine).toBe(true);
  });

  test("content lines starting with -- and ++ survive", () => {
    const TRICKY = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,2 +1,2 @@",
      "--x",
      "++y",
      "",
    ].join("\n");
    const h = new DiffParser().parse(TRICKY).hunks[0]!;
    expect(h.lines[1]!.text).toBe("--x");
    expect(h.lines[1]!.type).toBe(DiffLineType.Delete);
    expect(h.lines[2]!.text).toBe("++y");
    expect(h.lines[2]!.type).toBe(DiffLineType.Add);
  });

  test("empty context line (bare space) is preserved", () => {
    const BLANK = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,3 +1,3 @@",
      " ",
      "-a",
      "+b",
      " ",
      "",
    ].join("\n");
    const h = new DiffParser().parse(BLANK).hunks[0]!;
    expect(h.lines[1]!.text).toBe(" ");
    expect(h.lines[1]!.type).toBe(DiffLineType.Context);
  });
});
```

Note: DiffParser.parse expects the text to start at the `---` header (GHD strips the `diff --git`/`index` preamble before calling it; confirm against the upstream parser source while vendoring; if it tolerates the preamble, feed real `git diff` output in one extra test to pin that).

- [ ] **Step 4: Run to green**

Run: `cd packages/git-core` then `bun test src/__tests__/vendor-diff-parser.test.ts`
Expected: PASS. A failure here means the copy or the helper inlining diverged from upstream; fix the copy, never the assertion, unless the assertion mis-transcribed upstream behavior (verify against upstream `app/test/unit/diff-parser-test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/git-core/src/vendor packages/git-core/src/__tests__/vendor-diff-parser.test.ts
git commit -m "git-core: vendor GHD DiffParser with inlined pure helpers"
```

---

### Task 3: Vendor patch-formatter with narrowed signatures + ported upstream tests

**Files:**
- Create: `packages/git-core/src/vendor/ghd/types.ts`
- Create: `packages/git-core/src/vendor/ghd/patch-formatter.ts`
- Modify: `packages/git-core/src/vendor/ghd/README.md`
- Test: `packages/git-core/src/__tests__/patch-formatter.test.ts`

**Interfaces:**
- Consumes: Task 1 models, Task 2 parser (in tests).
- Produces:
```ts
// vendor/ghd/types.ts
export enum AppFileStatusKind { /* 9 members verbatim from upstream models/status.ts */ }
export interface PatchTarget {
  readonly path: string
  readonly status: { readonly kind: AppFileStatusKind }
  readonly selection: DiffSelection
}
export interface TextDiffLike { readonly hunks: ReadonlyArray<DiffHunk> }
// vendor/ghd/patch-formatter.ts
export function formatPatch(file: PatchTarget, diff: TextDiffLike): string
export function formatPatchToDiscardChanges(
  filePath: string, diff: TextDiffLike, selection: DiffSelection
): string | null
```

- [ ] **Step 1: Write `types.ts`**

Copy the `AppFileStatusKind` enum member list verbatim from `/Users/matt/Documents/GitHub/github-desktop/app/src/models/status.ts` (9 members). Add the two structural types above (this replaces vendoring `status.ts` at 421 lines and `diff-data.ts` at 129; the formatter reads only `.path`, `.status.kind`, `.selection`, `.hunks`).

- [ ] **Step 2: Copy `patch-formatter.ts`**

From `/Users/matt/Documents/GitHub/github-desktop/app/src/lib/patch-formatter.ts` (335 lines). Edits, and ONLY these:
1. Imports: models from `./raw-diff` / `./diff-line` / `./diff-selection`, `assertNever` from `./fatal-error`, `AppFileStatusKind`/`PatchTarget`/`TextDiffLike` from `./types`.
2. Signature narrowing: `WorkingDirectoryFileChange` becomes `PatchTarget`; `ITextDiff | ILargeTextDiff` and `ITextDiff` become `TextDiffLike`.
3. Delete the `log.debug(...)` call (upstream line ~225). Nothing replaces it.

Keep every upstream comment, especially the counter bookkeeping comments in `formatPatchToDiscardChanges` (the inverted-looking `newCount++`/`oldCount++` is correct only because the emitted hunk header swaps its argument order; the comments are the guard against a future "fix").

- [ ] **Step 3: Write the failing test suite**

`packages/git-core/src/__tests__/patch-formatter.test.ts`. Port upstream cases via inline diffs + the vendored parser (upstream cases 5-8 nearly verbatim; 1-4 rebuilt inline since we do not vendor their fixture repo). A local helper stands in for GHD's `parseDiff`:

```ts
import { describe, expect, test } from "bun:test";
import { DiffParser } from "../vendor/ghd/diff-parser.ts";
import {
  DiffSelection,
  DiffSelectionType,
} from "../vendor/ghd/diff-selection.ts";
import { AppFileStatusKind } from "../vendor/ghd/types.ts";
import {
  formatPatch,
  formatPatchToDiscardChanges,
} from "../vendor/ghd/patch-formatter.ts";

function parse(text: string) {
  return { hunks: new DiffParser().parse(text).hunks };
}
function target(path: string, kind: AppFileStatusKind, selection: DiffSelection) {
  return { path, status: { kind }, selection };
}
```

Cases (each asserts the FULL expected patch string, the report's highest-value pattern):

1. **Unselected deletions become context.** Diff with `-a`, `-b`, `+c`; select only the add. Expected patch keeps `a`/`b` as ` a`/` b` context lines with a rewritten `@@` header.
2. **Unselected added lines are dropped entirely** (not context).
3. **New-file header rewrite.** `AppFileStatusKind.New` with an all-lines selection over a `@@ -0,0 +1 @@`-shaped diff; expected output contains `--- /dev/null` and `@@ -0,0 +1 @@`.
4. **Empty context line survives** as a bare `" "` line.
5. **No-newline marker is re-emitted** after the corresponding line.
6. **Hunk 2 of 2 selected**: header of the emitted hunk is renumbered relative to what is actually included (assert exact `@@` line).
7. **Empty selection throws** (formatPatch) and **returns null** (formatPatchToDiscardChanges).
8. **Discard patch is pre-reversed**: for `-old`/`+new` fully selected, `formatPatchToDiscardChanges` output contains `+old` and `-new` with the hunk header ranges swapped (assert the exact `@@` line).

Compute the exact expected strings by hand while writing each case; every assertion is `expect(patch).toBe(EXPECTED)` on a full string, not a substring probe, except case 7.

- [ ] **Step 4: Run to green**

Run: `cd packages/git-core` then `bun test src/__tests__/patch-formatter.test.ts`
Expected: PASS. Hand-computed expected strings that disagree with the formatter are resolved by consulting upstream `app/test/unit/patch-formatter-test.ts` for the analogous case; upstream behavior wins.

- [ ] **Step 5: Run the whole package suite and check types**

Run: `bun test src` then `bun run check-types` (both from `packages/git-core`).

- [ ] **Step 6: Commit**

```bash
git add packages/git-core/src/vendor packages/git-core/src/__tests__/patch-formatter.test.ts
git commit -m "git-core: vendor GHD patch-formatter behind narrowed types"
```

---

### Task 4: Apply layer: stagingDiff / stageSelection / discardSelection

**Files:**
- Modify: `packages/git-core/src/exec.ts`
- Create: `packages/git-core/src/staging.ts`
- Modify: `packages/git-core/src/types.ts`
- Modify: `packages/git-core/src/client.ts`
- Test: `packages/git-core/src/__tests__/staging.test.ts`

**Interfaces:**
- Consumes: `DiffParser`, `formatPatch`, `formatPatchToDiscardChanges`, `DiffSelection`, `AppFileStatusKind`, Task 1-3 types; `rawGit` from exec.ts.
- Produces (added to `GitClient` and exported from `src/index.ts`):
```ts
export interface StagingDiff {
  path: string;
  kind: "text" | "binary" | "submodule";
  untracked: boolean;
  hunks: ReadonlyArray<import("./vendor/ghd/raw-diff.ts").DiffHunk>;
}
stagingDiff(path: string): Promise<StagingDiff>
stageSelection(diff: StagingDiff, selection: DiffSelection, opts?: { originalPath?: string }): Promise<void>
discardSelection(diff: StagingDiff, selection: DiffSelection): Promise<void>
```
Re-export `DiffSelection`, `DiffSelectionType` from `src/index.ts` so consumers never import from vendor paths.

- [ ] **Step 1: Extend exec.ts with stdin support (failing test first)**

Add to `RawGitOpts`: `stdin?: string`. In `rawGit`, when `opts.stdin !== undefined`, spawn with `stdin: "pipe"`, write the string, close. Also add:

```ts
export async function rawGitOk(dir: string, args: string[]): Promise<boolean>
// exit 0 => true, exit 1 => false, anything else throws (reuses the same spawn path)
```

Test (in staging.test.ts or a small exec test block): `rawGit(dir, ["hash-object", "--stdin"], { stdin: "hello\n" })` returns the known blob sha `ce013625030ba8dba906f756967f9e9ca394464a`.

- [ ] **Step 2: Write failing staging conformance tests**

`packages/git-core/src/__tests__/staging.test.ts`, using `makeSandbox()`:

1. **Stage one added line out of several.** Commit `a\nb\nc\n`; rewrite to `a\nX\nb\nY\nc\n`. `stagingDiff` then a None-selection with only the `+X` line index flipped true (find the index by scanning `hunks[].lines` for `text === "+X"`, using the hunk's `unifiedDiffStart` + offset). `stageSelection`, then assert `git diff --cached` contains `+X` and not `+Y`, and `git diff` (unstaged) still contains `+Y`.
2. **Stage lines of an untracked file.** Write new file `n.txt` with 3 lines, select all: after `stageSelection`, `git diff --cached --name-status` reports `A\tn.txt`. Select-partial variant: only line 1 selected stages a 1-line blob.
3. **Discard one line.** From state in case 1 (before staging), discard only `+Y`: file content on disk becomes `a\nX\nb\nc\n`, `+X` still present as an unstaged change.
4. **No-newline file roundtrip.** Commit file without trailing newline; modify it; stage full selection; `git diff --cached` output ends with the `\ No newline at end of file` marker and `git status --porcelain` shows no unstaged remainder for the path.
5. **Rename pre-stage.** Commit `old.txt`, `git mv old.txt new.txt`, edit one line in `new.txt`. `stageSelection(diff, allSelection, { originalPath: "old.txt" })` stages the rename plus the edit: `git diff --cached --name-status -M` reports an `R` record for old->new.
6. **Binary refusal.** Write a file containing `\x00` bytes; `stagingDiff` reports `kind: "binary"`; `stageSelection` on it rejects with an error naming the path.
7. **Discard on untracked refusal.** `discardSelection` on an untracked-file diff rejects (file-level discard already exists in rt; line-discard of an untracked file is undefined upstream too).

- [ ] **Step 3: Implement `staging.ts`**

```ts
import type { ClientContext } from "./client.ts";
import { rawGit } from "./exec.ts";
import { DiffParser } from "./vendor/ghd/diff-parser.ts";
import type { DiffSelection } from "./vendor/ghd/diff-selection.ts";
import { AppFileStatusKind } from "./vendor/ghd/types.ts";
import {
  formatPatch,
  formatPatchToDiscardChanges,
} from "./vendor/ghd/patch-formatter.ts";
import type { StagingDiff } from "./types.ts";

const APPLY_FLAGS = ["--unidiff-zero", "--whitespace=nowarn", "-"];

export async function getStagingDiff(ctx: ClientContext, path: string): Promise<StagingDiff> {
  const status = await ctx.git.status();
  const untracked = status.not_added.includes(path);
  const text = untracked
    ? await rawGit(ctx.dir, ["diff", "--no-index", "--", "/dev/null", path], { okCodes: [1] })
    : await ctx.git.diff(["--", path]);
  // classification mirrors diff.ts (Task 11 unifies the classifier if drift appears)
  if (/^Binary files .* differ$/m.test(text)) {
    return { path, kind: "binary", untracked, hunks: [] };
  }
  if (/^(old|new) mode 160000$/m.test(text) || /^index [0-9a-f.]+ 160000$/m.test(text)) {
    return { path, kind: "submodule", untracked, hunks: [] };
  }
  const body = text.slice(text.indexOf("--- "));
  const hunks = text.trim() === "" ? [] : new DiffParser().parse(body).hunks;
  return { path, kind: "text", untracked, hunks };
}
```

(`DiffParser.parse` expectation about the preamble was pinned in Task 2; adjust the `body` slice to match what that test established. A diff with no `--- ` header and no hunks yields `hunks: []`.)

`stageSelection`:
- refuse non-text kinds: `throw new Error(\`cannot line-stage ${diff.kind} file: ${diff.path}\`)`
- when `opts.originalPath` is set, run the GHD rename pre-stage recipe first:
  `git add --update -- <originalPath>`, then `git ls-tree HEAD -- <originalPath>` to read `<mode> blob <oid>\t<path>`, then `git update-index --add --cacheinfo <mode>,<oid>,<newPath>` (comma form takes one arg), all via `rawGit`.
- build the target: kind `Untracked` when `diff.untracked`, else `Modified`; `formatPatch({ path: diff.path, status: { kind }, selection }, { hunks: diff.hunks })`
- apply: `rawGit(ctx.dir, ["apply", "--cached", ...APPLY_FLAGS], { stdin: patch })`

`discardSelection`:
- refuse `diff.untracked` and non-text kinds
- `const patch = formatPatchToDiscardChanges(diff.path, { hunks: diff.hunks }, selection); if (patch === null) return;`
- `rawGit(ctx.dir, ["apply", ...APPLY_FLAGS], { stdin: patch })` (no `-R`, no `--cached`: the reversal is baked into the patch text and it targets the working tree)

- [ ] **Step 4: Wire types.ts, client.ts, index.ts**

Add `StagingDiff` + the three method signatures to `GitClient`; wire in `createGitClient`; re-export `DiffSelection`, `DiffSelectionType`, `StagingDiff` from `src/index.ts`.

- [ ] **Step 5: Run to green, then full package suite**

Run: `cd packages/git-core` then `bun test src/__tests__/staging.test.ts`, then `bun test src`, then `bun run check-types`.

- [ ] **Step 6: Commit**

```bash
git add packages/git-core/src
git commit -m "git-core: line staging and discard via vendored GHD patch pipeline"
```

---

### Task 5: Commit ergonomics in lib/commit-ops.ts

**Files:**
- Modify: `lib/commit-ops.ts` (extend `commitStaged`)
- Test: `lib/__tests__/commit-ops.test.ts` (extend the existing suite, follow its setup pattern)

**Interfaces:**
- Consumes: nothing new.
- Produces:
```ts
export interface CommitOptions {
  amend?: boolean;
  noVerify?: boolean;
  allowEmpty?: boolean;
  coAuthors?: string[]; // "Name <email>" strings, appended as Co-Authored-By trailers
}
export function commitStaged(cwd: string, message: string, opts: CommitOptions = {}): string
```
Existing two-arg callers compile unchanged.

- [ ] **Step 1: Write failing tests** (in the existing test file's sandbox pattern):
  1. multi-line message with blank line commits verbatim (`git log -1 --format=%B` matches)
  2. `coAuthors: ["A B <a@b.c>"]` produces a body ending `Co-Authored-By: A B <a@b.c>` separated from the message by a blank line
  3. `amend: true` replaces the previous commit (log count unchanged, message replaced)
  4. `allowEmpty: true` commits with a clean index
  5. `noVerify: true` commits despite a pre-commit hook that exits 1 (write an executable failing hook into `.git/hooks/pre-commit`; also assert the same commit WITHOUT noVerify throws)

- [ ] **Step 2: Implement**

```ts
export function commitStaged(cwd: string, message: string, opts: CommitOptions = {}): string {
  const trailers = (opts.coAuthors ?? [])
    .map((a) => `Co-Authored-By: ${a}`)
    .join("\n");
  const fullMessage = trailers ? `${message}\n\n${trailers}` : message;
  const args = ["commit", "-m", fullMessage];
  if (opts.amend) args.push("--amend");
  if (opts.noVerify) args.push("--no-verify");
  if (opts.allowEmpty) args.push("--allow-empty");
  const out = git(cwd, args);
  return out.split("\n")[0] ?? "";
}
```

- [ ] **Step 3: Run** `bun test lib/__tests__/commit-ops.test.ts` to green.
- [ ] **Step 4: Commit**

```bash
git add lib/commit-ops.ts lib/__tests__/commit-ops.test.ts
git commit -m "commit-ops: amend, no-verify, allow-empty, co-author trailers"
```

---

### Task 6: undoLastCommit + resetToCommit in git-core

**Files:**
- Create: `packages/git-core/src/commits.ts`
- Modify: `packages/git-core/src/types.ts`, `src/client.ts`, `src/index.ts`
- Test: `packages/git-core/src/__tests__/commits.test.ts`

**Interfaces:**
- Produces:
```ts
export type UndoRefusal = "pushed" | "initial" | "merge";
export type UndoResult =
  | { ok: true; undoneSha: string }
  | { ok: false; reason: UndoRefusal };
undoLastCommit(): Promise<UndoResult>
resetToCommit(sha: string, mode: "soft" | "mixed" | "hard"): Promise<void>
```

- [ ] **Step 1: Failing tests** (sandbox):
  1. undo an unpushed commit: returns ok with the old HEAD sha; `git log` count drops by 1; the commit's changes remain in the working tree unstaged (mixed reset semantics)
  2. pushed refusal: `addBareRemote()`, `git push origin main`, set upstream via `git branch --set-upstream-to origin/main`; undo returns `{ ok: false, reason: "pushed" }` and HEAD is unchanged
  3. initial refusal: single-commit repo returns `reason: "initial"`
  4. merge refusal: create branch, commit on both, `git merge --no-ff`; returns `reason: "merge"`
  5. resetToCommit hard restores an older tree; soft keeps changes staged; mixed keeps them unstaged (three asserts against `git status --porcelain`)

- [ ] **Step 2: Implement `commits.ts`**

Pushed-check without `@{u}` shorthand: read the current branch's upstream from the existing `getBranches(ctx)` (the entry with `current: true`); when it has an upstream and `rawGitOk(dir, ["merge-base", "--is-ancestor", "HEAD", upstream])` is true, refuse `"pushed"`. Parent shape via `rawGit(dir, ["rev-list", "--parents", "-n", "1", "HEAD"])`: 1 token = no parents (`"initial"`), 3+ tokens = merge (`"merge"`). Otherwise capture HEAD sha, `ctx.git.reset(["--mixed", "HEAD~1"])`, return ok. `resetToCommit`: `ctx.git.reset([`--${mode}`, sha])`.

Detached HEAD: `getBranches` has no `current` entry; treat as no-upstream (undo allowed). Cover in the conformance sweep (Task 12).

- [ ] **Step 3: Wire client/types/index, run to green, full suite.**
- [ ] **Step 4: Commit**

```bash
git add packages/git-core/src
git commit -m "git-core: undoLastCommit with pushed/initial/merge refusals, resetToCommit"
```

---

### Task 7: Stash mutations

**Files:**
- Modify: `packages/git-core/src/stash.ts`, `src/types.ts`, `src/client.ts`, `src/index.ts`
- Test: `packages/git-core/src/__tests__/stash-mutations.test.ts`

**Interfaces:**
- Produces:
```ts
stashPush(opts?: { message?: string; includeUntracked?: boolean }): Promise<{ created: boolean }>
stashApply(index: number): Promise<void>
stashPop(index: number): Promise<void>
stashDrop(index: number): Promise<void>
```

- [ ] **Step 1: Failing tests**:
  1. push with message then `stashes()` lists it at index 0 with the message; working tree clean after push
  2. push with nothing to stash returns `{ created: false }` and adds no entry
  3. `includeUntracked: true` stashes an untracked file (tree clean incl. untracked after)
  4. apply(0) restores changes and keeps the entry; pop(0) restores and removes; drop(0) removes without touching the tree
  5. pop on an empty stash list rejects with an error mentioning the ref

- [ ] **Step 2: Implement** via `ctx.git.stash([...])`: push args `["push", ...(m ? ["-m", m] : []), ...(u ? ["-u"] : [])]`, detect `created` from output not containing `No local changes to save`; apply/pop/drop take `[verb, \`stash@{${index}}\`]`.
- [ ] **Step 3: Green + full suite.**
- [ ] **Step 4: Commit**

```bash
git add packages/git-core/src
git commit -m "git-core: stash push/apply/pop/drop"
```

---

### Task 8: Branch primitives in git-core

**Files:**
- Create: `packages/git-core/src/branch-ops.ts`
- Modify: `src/types.ts`, `src/client.ts`, `src/index.ts`
- Test: `packages/git-core/src/__tests__/branch-ops.test.ts`

**Interfaces:**
- Produces (raw, unguarded; guards are Task 9, rt-side):
```ts
checkoutBranch(name: string): Promise<void>
createBranch(name: string, opts?: { from?: string; checkout?: boolean }): Promise<void>
```

- [ ] **Step 1: Failing tests**: create (exists in `branches()`, HEAD unmoved), create with `checkout: true` (HEAD moves), create `from` an older sha (branch tip = that sha), checkout switches branches, checkout with a conflicting dirty file rejects and the git error text surfaces.
- [ ] **Step 2: Implement** with `ctx.git.checkout([name])` / `ctx.git.branch([name, ...(from ? [from] : [])])` (+ checkout when asked).
- [ ] **Step 3: Green + commit**

```bash
git add packages/git-core/src
git commit -m "git-core: checkoutBranch and createBranch primitives"
```

---

### Task 9: rt-side branch guard (stack + worktree ownership)

**Files:**
- Create: `lib/branch-guard.ts`
- Test: `lib/__tests__/branch-guard.test.ts`

**Interfaces:**
- Consumes: `checkStackMembership`, `StackVerdict`, `StackGuardRunners` from `lib/stack-guard.ts`; `listWorktreesAsync` from `lib/worktree/git-async.ts`.
- Produces:
```ts
export type BranchGuardVerdict =
  | { verdict: "clear" }
  | { verdict: "refuse"; reason: "stack" | "worktree"; detail: string }
  | { verdict: "unverified"; detail: string };
export async function checkBranchGuard(opts: {
  cwd: string;
  branch: string;
  defaultBranch: string | null;
  runners: StackGuardRunners;
  listWorktrees?: typeof listWorktreesAsync; // injectable for tests
}): Promise<BranchGuardVerdict>
```
Semantics: worktree ownership is checked first (cheap, local): if any worktree entry other than the one containing `cwd` has `branch === opts.branch`, refuse with the owning path in `detail`. Then the stack check: a `refuse` from `checkStackMembership` maps to `reason: "stack"` with the refusal hint as `detail`; `unverified` passes through as `unverified`. Callers (RT-190/191) decide what unverified means for their UX; this module never guesses.

- [ ] **Step 1: Failing tests** with fake runners (no real gitq/forge): worktree-owned branch refuses with the path; gitq stack member refuses with the stack hint; forge-unavailable maps to unverified; clean branch is clear. Use a real temp repo with `git worktree add` for the ownership case (plain `git worktree add` is fine here: this is a scratch repo inside the test's tmpdir, not an rt-managed repo).
- [ ] **Step 2: Implement (~40 lines).**
- [ ] **Step 3: Green + commit**

```bash
git add lib/branch-guard.ts lib/__tests__/branch-guard.test.ts
git commit -m "add lib/branch-guard.ts: stack + worktree ownership checkout guard"
```

---

### Task 10: Tag mutations + TagInfo.targetSha (hardening item 5)

**Files:**
- Modify: `packages/git-core/src/refs.ts`, `src/types.ts`, `src/client.ts`, `src/index.ts`
- Test: `packages/git-core/src/__tests__/tags-mutations.test.ts` (+ extend `refs.test.ts` assertions for targetSha)

**Interfaces:**
- Produces:
```ts
// TagInfo gains: targetSha: string  (the commit a tag points at; for lightweight tags equal to sha)
createTag(name: string, opts?: { message?: string; sha?: string }): Promise<void> // message => annotated
deleteTag(name: string): Promise<void>
pushTag(name: string, remote?: string): Promise<void> // default "origin"
```

- [ ] **Step 1: Failing tests**: lightweight tag has `annotated: false` and `targetSha === sha`; annotated tag has `annotated: true`, `sha !== targetSha`, `targetSha` equals the tagged commit; create at an explicit older sha; delete removes from `tags()`; pushTag to `addBareRemote()` makes `git ls-remote --tags origin` list it.
- [ ] **Step 2: Implement**: TAG_FORMAT gains `%(*objectname)` as a 4th field; `targetSha = deref !== "" ? deref : sha`. Mutations via `ctx.git.tag([...])` (annotated: `["-a", name, "-m", message, ...(sha ? [sha] : [])]`) and `ctx.git.push(remote, name)` for pushTag; delete via `ctx.git.tag(["-d", name])`.
- [ ] **Step 3: Green + full suite + commit**

```bash
git add packages/git-core/src
git commit -m "git-core: tag create/delete/push and dereferenced targetSha"
```

---

### Task 11: Hardening sweep A: diff classifier + untracked hint (items 1, 2, 4)

**Files:**
- Modify: `packages/git-core/src/diff.ts`, `src/types.ts` (diffFile opts)
- Test: extend `packages/git-core/src/__tests__/diff.test.ts`

**Interfaces:**
- `diffFile(path, opts?: { staged?: boolean; untracked?: boolean })`: when `opts.untracked` is provided (either value), the `git status` probe is skipped and the hint is trusted. Omitted keeps today's behavior. `snapshot()` consumers (RT-190) can then fan out N diffs on one status call.

- [ ] **Step 1: Failing tests**:
  1. a text diff whose CONTENT contains the literal line `GIT binary patch` still classifies as `kind: "text"` (item 1: that substring check could only false-positive since no `--binary` flag is ever passed; delete the branch)
  2. a text diff whose content contains a line `+Subproject commit abc123` (e.g. committing a doc that quotes one) classifies as text (item 2)
  3. a REAL submodule change classifies as `kind: "submodule"`: in the sandbox create an inner repo, `git -c protocol.file.allow=always submodule add ./inner sub`, commit, then move the submodule HEAD and diff (mode `160000` appears in the header; classify from `/^(old|new) mode 160000$/m` or `/^index [0-9a-f.]+ 160000$/m`, matching Task 4's classifier)
  4. `diffFile(path, { untracked: true })` on an untracked file returns its hunks without any `git status` call (assert equal output to the unhinted call; the skipped-probe claim is structural: the implementation reads the hint before any status call)
- [ ] **Step 2: Implement** (delete the `GIT binary patch` branch, replace the Subproject regex with the mode-based classifier, thread the hint through `getFileDiff`).
- [ ] **Step 3: Green + full suite + commit**

```bash
git add packages/git-core/src
git commit -m "git-core: mode-based submodule detection, drop binary-patch probe, untracked hint"
```

---

### Task 12: Hardening sweep B: splitter, locale, FetchState contract + docs + conformance extension

**Files:**
- Modify: `packages/git-core/src/log.ts` (item 3), `src/client.ts` (item 7), `src/fetch-state.ts` + `src/types.ts` (item 8), `packages/git-core/README.md`
- Test: extend `log.test.ts`, `fetch-state.test.ts`, `conformance.test.ts`

- [ ] **Step 1: Failing tests**:
  1. item 3: a commit whose BODY contains simple-git's default record separator byte `\xF2` round-trips intact through `log()` (pass `splitter: "\x00"` in the log options object)
  2. item 7: remove the English-text dependency deterministically instead of pinning locale. `getLog` first runs `rawGitOk(dir, ["rev-parse", "--verify", "HEAD"])`; when false (unborn/empty repo) it returns `[]` before ever invoking simple-git log, so the localized-message catch is no longer the only path. Keep the existing catch as fallback. Failing test: delete the message-matching catch body temporarily to confirm the new guard alone makes the empty-repo test pass, then restore the catch (documents that the guard, not the English match, now carries the case). Additionally pin `client.ts` simple-git construction with `.env({ ...process.env, LC_ALL: "C", LANG: "C" })`; no dedicated test (not deterministically observable), noted as such in the report
  3. item 8: `FetchState.lastFetchedAt` becomes `string | null` (ISO 8601, `mtime.toISOString()`); update the type, implementation, and existing tests; grep the repo for other consumers first (expected: none outside git-core tests)
- [ ] **Step 2: README.md updates** (packages/git-core/README.md): document the mutation surface (staging coordinate space: DiffSelection indexes the unified diff including hunk header lines; vendored provenance pointer), the unborn-branch asymmetry (snapshot().branch reports the symbolic name e.g. "main" while branches() is []), and that all timestamps in the contract are ISO strings.
- [ ] **Step 3: Conformance extension** in `conformance.test.ts`: run the new mutation verbs against the hostile states where they must fail CLEANLY (typed refusal or descriptive throw, never a hang or corruption): empty repo (undo -> initial refusal; stashPush -> created:false; stagingDiff on missing path), detached HEAD (undo allowed, stash roundtrip works), mid-merge conflict (stagingDiff on a conflicted path returns text kind without throwing; commitStaged surfaces git's own refusal).
- [ ] **Step 4: Green, full package suite, `bun run check-types`, then root `bun run test` and `bun run test:e2e` (release-gate parity; e2e is NOT covered by `bun run test`).**
- [ ] **Step 5: Commit**

```bash
git add packages/git-core lib
git commit -m "git-core: NUL log splitter, C locale, ISO fetch state, contract docs"
```

---

## Self-Review Notes

- Spec coverage: RT-189's six units map to Tasks 1-4 (staging/discard), 5 (commit++), 6 (undo/reset), 7 (stash), 8+9 (guarded branch ops), 10 (tags); hardening items 1-8 (minus done item 6) map to Tasks 10 (item 5), 11 (items 1, 2, 4), 12 (items 3, 7, 8). "Upstream unit tests" are honored as ports where upstream tests exist (formatter cases) and as new suites where upstream has none (DiffSelection; verified absent upstream).
- Type consistency: `StagingDiff.hunks` uses the VENDOR `DiffHunk` (GHD model), which is intentionally distinct from the read-model `DiffHunk` in `src/types.ts`; they never mix (staging.ts imports the vendor type, diff.ts the local one). `index.ts` re-exports the vendor selection types under their own names; the two hunk types must NOT both be exported under the same name (export the vendor one as `StagingHunk` if a collision arises).
- The `git apply` flag set (`--cached --unidiff-zero --whitespace=nowarn -`, stdin patch, discard without `-R`) is copied from upstream `app/src/lib/git/apply.ts` behavior exactly.
