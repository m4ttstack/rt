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

## Edits Made to Vendored Files

| File | Edit | Reason |
|---|---|---|
| `diff-selection.ts` | Import path changed from `../../lib/fatal-error` to `./fatal-error` | Consolidate vendored files into single directory |
| `fatal-error.ts` | Trimmed to only assertNever export; Electron-specific fatalError machinery dropped | Only the assertion utility is needed for vendor scope |
| `raw-diff.ts` | Line 56: added non-null assertion `other.lines[ix]!` | Repo enables noUncheckedIndexedAccess; upstream code indexes without length guard |
| `diff-parser.ts` | Imports: `IRawDiff` as type-only (line 1), models from `./raw-diff` and `./diff-line`, helpers from `./support`; Line 152: `this.text[p]!`; Lines 269-270: `c[0]!` (two places); Line 332: `lines[previousLineIndex]!` | Consolidate imports; verbatimModuleSyntax; noUncheckedIndexedAccess constraint |
| `support.ts` | Parameters widened from `DiffHunk[]` to `ReadonlyArray<DiffHunk>` (line 47); Lines 58, 61: added non-null assertions `hunks[i]!` and `hunk.lines[j]!` | UI source used array; vendoring uses readonly; noUncheckedIndexedAccess constraint |
