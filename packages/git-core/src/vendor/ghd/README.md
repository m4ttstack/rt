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
| `diff-parser.ts` | Import paths: models from `./raw-diff` and `./diff-line`; helpers from `./support`; Line 336: added non-null assertion `lines[previousLineIndex]!` | Consolidate imports; noUncheckedIndexedAccess constraint |
| `support.ts` | New file containing inlined pure helper functions | UI imports (`text-diff-expansion.ts`, `diff-helpers.tsx`) are TS/React-only and not vendored; only pure functions needed here |
