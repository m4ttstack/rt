# Vendored GitHub Desktop Diff Models

Source repository: https://github.com/desktop/desktop
Local clone commit: 9dfe6e60
License: MIT (see LICENSE)

## Vendor Files

| Vendor file | Upstream source |
|---|---|
| `diff-line.ts` | `app/src/models/diff/diff-line.ts` |
| `raw-diff.ts` | `app/src/models/diff/raw-diff.ts` |
| `diff-selection.ts` | `app/src/models/diff/diff-selection.ts` |
| `fatal-error.ts` | `app/src/lib/fatal-error.ts` (trimmed) |
| `diff-parser.ts` | `app/src/lib/diff-parser.ts` |
| `support.ts` | `app/src/ui/diff/text-diff-expansion.ts` + `app/src/ui/diff/diff-helpers.tsx` (inlined pure helpers) |
| `types.ts` | N/A (custom) |
| `patch-formatter.ts` | `app/src/lib/patch-formatter.ts` |
| `log-parse.ts` | `app/src/lib/git/log.ts` (`mapSubmoduleStatusFileModes`, `mapStatus`, `parseRawLogWithNumstat`), `app/src/lib/git/git-delimiter-parser.ts` (`createLogParser`), `app/src/models/commit-identity.ts` (`parseIdentity`), `app/src/lib/git/interpret-trailers.ts` (`parseSingleUnfoldedTrailer`, `parseRawUnfoldedTrailers`, `isCoAuthoredByTrailer`), `app/src/models/git-author.ts` (`parse`), `app/src/models/commit.ts` (`extractCoAuthors`), `app/src/models/status.ts` (status types) |

## Edits Made to Vendored Files

| File | Edit | Reason |
|---|---|---|
| `diff-selection.ts` | Import path changed from `../../lib/fatal-error` to `./fatal-error` | Consolidate vendored files into single directory |
| `fatal-error.ts` | Trimmed to only assertNever export; Electron-specific fatalError machinery dropped | Only the assertion utility is needed for vendor scope |
| `raw-diff.ts` | Line 56: added non-null assertion `other.lines[ix]!` | Repo enables noUncheckedIndexedAccess; upstream code indexes without length guard |
| `raw-diff.ts` | `DiffHunkHeader.equals`: final comparison changed from `this.oldStartLine === other.oldStartLine` (repeated) to `this.newLineCount === other.newLineCount` | Upstream equality bug: headers differing only in newLineCount compared equal |
| `diff-parser.ts` | Imports: `IRawDiff` as type-only (line 1), models from `./raw-diff` and `./diff-line`, helpers from `./support`; Line 152: `this.text[p]!`; Lines 269-270: `c[0]!` (two places); Line 332: `lines[previousLineIndex]!` | Consolidate imports; verbatimModuleSyntax; noUncheckedIndexedAccess constraint |
| `support.ts` | Parameters widened from `DiffHunk[]` to `ReadonlyArray<DiffHunk>` (line 47); Lines 58, 61: added non-null assertions `hunks[i]!` and `hunk.lines[j]!` | UI source used array; vendoring uses readonly; noUncheckedIndexedAccess constraint |
| `types.ts` | N/A | Custom narrowed types file; AppFileStatusKind enum copied verbatim from upstream; PatchTarget and TextDiffLike interfaces defined for formatter |
| `patch-formatter.ts` | Line 2: split imports (AppFileStatusKind value import, PatchTarget/TextDiffLike type-only imports) for verbatimModuleSyntax; Line 67: `assertNever(file.status.kind, ...)` instead of `assertNever(file.status, ...)` for type safety; Deleted line 225 log.debug call | Imports: consolidate paths to ./types, ./diff-line, ./diff-selection, ./fatal-error; Signature narrowing: WorkingDirectoryFileChange -> PatchTarget, ITextDiff \| ILargeTextDiff -> TextDiffLike; Type narrowing in assertNever call |
| `log-parse.ts` | Classes (`CommitIdentity`, `GitAuthor`, `CommittedFileChange`) become plain records; `createLogParser` takes strings only (no Buffer path); `!`/`forceUnwrap` added for noUncheckedIndexedAccess | rt reads git output as strings; repo compiler settings |
| `fatal-error.ts` | Added `forceUnwrap`, throwing a plain Error instead of calling `fatalError` | Needed by `parseRawLogWithNumstat`; no Electron fatal-error machinery |

## Ported (not file-vendored) Modules

These live under `packages/git-core/src/` rather than here, since they are
behavioral ports (GHD's `repository: Repository` becomes `ctx: ClientContext`,
GHD's `git()` wrapper becomes `rawGit`) rather than copied files, but they are
verbatim ports of the same commit above.

| Module | Upstream source | GHD functions ported |
|---|---|---|
| `../../gitignore.ts` | `app/src/lib/git/gitignore.ts` | `ensureGitIgnoreIsNotSymbolicLink`, `openExistingGitIgnore`, `readGitIgnoreAtRoot`, `saveGitIgnore`, `appendIgnoreRule`, `appendIgnoreFile`, `escapeGitSpecialCharacters`, `formatGitIgnoreContents` (plus `getConfigValue` from `app/src/lib/git/config.ts`, narrowed to a single key lookup) |
| `../../discard.ts` | `app/src/lib/stores/git-store.ts` (`GitStore.discardChanges`, lines 1545-1650) | `discardChanges`, and its helpers from `app/src/lib/git/diff-index.ts` (`getIndexChanges`, `IndexStatus`, `getNoRenameIndexStatus`), `reset.ts` (`resetPaths`, narrowed to Mixed mode), `checkout-index.ts` (`checkoutIndex`), `submodule.ts` (`listSubmodules`, `resetSubmodulePaths`) |

Deviations from GHD in `discard.ts`: `moveToTrash` is always on with no
permanent-delete fallback (a Trash failure throws before any reset/checkout
step runs, where GHD falls back to `rm` for an untracked file or silently
skips a tracked one); the exit-128 retry gate in `getIndexChanges` and
`listSubmodules` (GHD reads `result.exitCode` off its `git()` wrapper) is
approximated with a catch on the default (0-only) exit set, since this
package's one raw runner (`exec.ts`'s `rawGit`) does not surface exit codes
to its callers.
