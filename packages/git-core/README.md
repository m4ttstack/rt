# @mattstack/git-core

Git facade for rt: typed snapshots, diffs, refs, log, stashes, fetch state,
and the mutation layer (staging, commit ergonomics, undo/reset, stash,
branch, and tag writes) over simple-git and a vendored diff/patch pipeline.
Private, source-only, consumed via the workspace.

What it deliberately is NOT:
- No worktree listing: rt's `lib/worktree/git-async.ts` owns that; the
  daemon layer composes the two.
- No forge calls: `@mattstack/glance` and the daemon MR cache own those.

Design rule: off-the-shelf clients do the parsing. Hand-written parsing
is limited to for-each-ref, stash reflog subjects, and FETCH_HEAD state,
each pinned by tests in `src/__tests__/`.

## Timestamps

Every timestamp in the contract (`LogEntry.authorDate`, `BranchInfo.committedAt`,
`FetchState.lastFetchedAt`) is an ISO 8601 string, never a `Date`. This keeps
the whole contract JSON-serializable across the daemon boundary without a
revive step.

## Mutation surface

### Staging: DiffSelection's coordinate space

`stagingDiff()` returns hunks parsed by the vendored GitHub Desktop diff
model (see `src/vendor/ghd/README.md` for provenance: source repo, pinned
commit, and the edits made to each vendored file). `stageSelection()` and
`discardSelection()` take a `DiffSelection` that indexes lines by their
position in the *unified diff*, counting the `@@ ... @@` hunk header line
itself as index 0 of that hunk. A selection built against the wrong
coordinate space (e.g. content-line-only indexing) silently stages or
discards the wrong lines rather than throwing, so callers must derive
indexes from the same parsed hunks this package returns, never recompute
them independently.

### Unborn-branch asymmetry

On a repo with no commits yet, `snapshot().branch` reports the symbolic
branch name (e.g. `"main"`) because git itself already knows the name HEAD
will take once a commit lands, while `branches()` returns `[]` because
`refs/heads/*` does not exist until that first commit is made. Code that
cross-checks `snapshot().branch` against `branches()` to resolve the current
branch's details must handle this as an expected empty result, not a bug.

### Hostile-state behavior

`src/__tests__/conformance.test.ts` pins how every read and mutation verb
behaves against unborn/empty repos, detached HEAD, and a mid-merge conflict.
Two results there are worth calling out because they read as reasonable
guesses that turned out not to match git: on a truly unborn repo, both
`undoLastCommit()` and `stashPush()` throw git's own error text rather than
returning a typed refusal or `{ created: false }` (there is no commit or
initial ref for either operation to reason about yet); and `stagingDiff()`
on a mid-merge conflicted path throws a parser error rather than returning
a `"text"` kind, because git emits a combined diff for an unmerged path and
the vendored hunk-header parser does not understand that format. All three
still fail cleanly: a descriptive throw, never a hang or a corrupted repo.
