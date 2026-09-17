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
