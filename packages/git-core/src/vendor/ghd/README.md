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

## Edits Made to Vendored Files

| File | Edit | Reason |
|---|---|---|
| `diff-selection.ts` | Import path changed from `../../lib/fatal-error` to `./fatal-error` | Consolidate vendored files into single directory |
