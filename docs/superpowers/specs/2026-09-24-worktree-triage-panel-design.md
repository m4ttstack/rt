# Worktree triage: a tray panel for trees that won't dispose

## Goal

After RT-267 the reactor disposes every merged tree it safely can, and the
ones it can't carry a `disposableReason` or `heldReason`. That reason is
not enough to decide what to do: on 2026-09-24 it took a manual walk through
eleven stuck trees, checking each one's push state, containment and dirt by
hand, to find that eight were safe, one was the only copy of a spike, one
held an uncommitted test, and one pointed at a deleted `/tmp` repo.

This adds a **Worktrees…** panel to the tray that does that walk for the
user: every stuck tree, why it's stuck, whether its work is safe elsewhere,
and one action per tree. A menu count and a once-a-day summary notification
make sure the panel gets opened.

Boards: `docs/design/worktrees/` (panel, entry points, state catalog, review
sheet; light and dark). The pen.dev source is
`~/Documents/worktree dispose picker.pen`.

## What counts as stuck

An ephemeral tree in the worktree registry of any registered repo that is:

- `state: "disposable"`, or
- `state: "claimed"` whose branch-cache MR is `merged` or `closed`, or
- broken: its path is missing, or its `.git` points at a gitdir that no
  longer exists.

Main, golden, unmanaged and on-deck trees are never listed. A claimed tree
with an open MR or no MR is not stuck (the stale-claim sweep owns it).

## Architecture

The daemon computes every verdict; the tray only renders. One read verb,
three action verbs, one scheduled sweep. The same verdicts are available to
the CLI (`rt worktree triage`) and to agents, so the tray never runs git and
never re-implements dispose's guards.

### `worktree:triage` (read-only)

Returns `{ rows: TriageRow[], banners: MergeCleanupOffRow[], counts }`.
`banners` is the existing `mergeCleanupOff` list from `worktree:list`.
`counts` is `{ needsDecision, safe, waiting, kept }`, where `needsDecision`
is `safe + look + only-copy + broken` (waiting and kept never count).

```ts
interface TriageRow {
  repo: string;                 // serialized repo identity
  tree: string;                 // registry name, e.g. "olive-marble"
  path: string;
  branch: string | null;
  mr: { iid: number; state: "opened" | "merged" | "closed"; title: string; at: string | null } | null;
  ticket: { identifier: string; title: string; stateName: string | null } | null;
  push: { kind: "pushed" | "in-main" | "remote-deleted" | "unpushed"; ahead?: number };
  containment: "in-default" | "on-remote" | "patch-identical" | "none";
  dirt: { kind: "none" | "junk" | "lockfile" | "real"; files: string[] };
  group: "safe" | "look" | "only-copy" | "waiting" | "broken" | "kept";
  verdict: string;              // one sentence: conclusion plus next step
  actions: TriageAction[];      // first entry is the primary button
  hold?: { kind: "process" | "orphan-stopping" | "herd" | "run"; detail: string };
  keptAt?: string;
}
type TriageAction = "dispose" | "review" | "push-branch" | "keep" | "unkeep"
  | "stop-process" | "open-herd" | "open-run" | "remove" | "open-finder" | "open-terminal" | "copy-path";
```

MR and ticket come from the branch cache (`MRInfo`, `LinearTicket`); triage
never calls a forge or Linear itself. A tree with no cache entry renders
with `mr: null`, `ticket: null`.

**Containment**, first match wins:

1. `in-default`: HEAD is an ancestor of the default branch.
2. `on-remote`: `origin/<branch>` exists and contains HEAD.
3. `patch-identical`: every commit not in the default branch is
   patch-identical to a commit in the merged MR's range. This is RT-271's
   check, and triage-dispose relies on dispose having it too (see Actions),
   so RT-271 lands first or ships as this work's first task.
4. `none`.

**Push** is derived from the same facts: `in-main` for `in-default`,
`pushed` for `on-remote`, `remote-deleted` when the branch is gone from
origin but containment is `patch-identical`, else `unpushed` with `ahead`.

**Dirt classes.** Nothing is called junk by guesswork:

- `junk`: every dirty path is untracked, and every file under it (from
  `git ls-files --others --exclude-standard`) matches one of the repo's
  `rt.worktrees.junk` globs. Default `[".visual/**", ".build/**",
  "**/node_modules/**", "**/.turbo/**", "**/build/**", "**/dist/**"]`, a new
  key registered in the settings registry per the rt-settings skill. The
  build-output globs cover the `packages/tenant/` case: build output for a
  package the branch doesn't have.
- `lockfile`: the only dirty path is `bun.lock` (or `pnpm-lock.yaml`), and
  every changed line is a workspace `"version"` line.
- `real`: anything else.

**Groups**, first match wins:

| Group | When |
|---|---|
| `broken` | path missing, or gitdir gone |
| `kept` | a keep record exists and its snapshot still matches |
| `waiting` | the reactor recorded a `heldReason`, a herd job still holds the tree, or a pipeline run is live in it |
| `only-copy` | containment `none` |
| `look` | dirt `real` |
| `safe` | everything else (containment is not `none`, dirt is `none`, `junk` or `lockfile`) |

Waiting rows reuse the RT-267 hold data: `heldReason`, the herd release rule
in `job-release.ts`, and `findRunningRunByWorktree`. A tree whose stale
orphan was just stopped reports `hold.kind: "orphan-stopping"` with no
primary action.

### Actions

Every action re-runs triage for that one tree under its tree lock and
refuses if the row's `group` or dirt no longer matches what the caller saw.
The caller passes back the row's `fingerprint` (HEAD sha, dirt hash, MR
state), so a tree that changed between render and click is never acted on.

- **`worktree:triage-dispose { repo, tree, fingerprint, discard?: "classified" | "all" }`**
  - `safe` rows: discards exactly the classified `junk`/`lockfile` paths,
    then calls `disposeTree` **unforced**, so the running-run, attended and
    grace guards still apply. Containment passes on its own because RT-271
    teaches dispose's containment guard the patch-identical case (the
    `in-default` and `on-remote` cases already pass its anchor check).
    `"classified"` is the only discard mode allowed here.
  - `look` rows: only with `discard: "all"`, which the Review sheet sends
    after the user saw the diff; still unforced.
  - `only-copy` rows: refused; the user pushes first or picks
    **Dispose anyway** from the row menu, which sends `discard: "all"` plus
    `confirmOnlyCopy: true`. That is the one path that calls `disposeTree`
    with `force`, the same explicit override `rt worktree dispose --force`
    is today.
  - Everything lands in the 14-day trash, as every dispose does today.
- **`worktree:keep` / `worktree:unkeep { repo, tree }`**: stores
  `{ keptAt, headSha, dirtHash, mrState }` on the registry row. Triage drops
  the record (the tree comes back as needing a decision) the moment any of
  the three differ.
- **`worktree:push-branch { repo, tree, fingerprint }`**: `git push -u origin
  <branch>`, then re-triages; the usual result is `safe`.
- `stop-process` reuses `killWorktreeProcesses`; `open-herd`, `open-run`,
  `open-finder`, `open-terminal` and `copy-path` are tray-side; `remove`
  (broken rows) drops the registry row and runs `git worktree prune` in the
  owning repo when that repo still exists.

None of these verbs is `agentSafe` except `worktree:triage` itself.

### Morning summary

A daemon `scheduleSweep` ("worktree-triage-summary", every 15 minutes)
emits `worktree:triage-summary { count, safe }` once per local day, at the
first tick at or after 09:00, and only when `needsDecision > 0`. The last
send date is stored in the kv store so a restart doesn't resend. The tray
posts one notification ("4 worktrees need a decision" / "2 can be cleaned
up in one click. Click to review.") through `NotificationManager`; clicking
it opens the panel. Never one notification per tree. The daemon's `cron.ts`
layer is not used: it only triggers commands on events and has no clock.

## Tray

- **Menu:** **Worktrees…** sits under **Processes…** with a badge carrying
  `needsDecision` when above zero. The count comes from the same
  `worktree:triage` call the panel makes, refreshed when the menu opens.
- **Panel:** a detached panel modelled on the process panel
  (`ProcessPanelController` pattern: an `ObservableObject` polling the
  daemon, footer status line for every action's outcome). Sections in order:
  repo banners, Needs a decision (safe, look, only-copy), Waiting, Broken,
  and a collapsed Kept disclosure. Header: count title, subtitle, and
  **Clean up N safe**, which sends `triage-dispose` for every `safe` row in
  turn and reports each result in the footer.
- **Row:** MR title (bold), then tree, repo and branch, then chips (MR,
  push, ticket), then the verdict line. Colour budget per row: the verdict
  icon and the MR chip (merged blue, closed red, open green). Verdict text,
  push and ticket chips are neutral; the one exception is the red icon on an
  `unpushed` chip. Kept rows render every chip and icon neutral.
- **Review sheet** (`look` rows): each dirty file's diff on a neutral
  background with only the `+`/`-` gutter coloured, and **Keep**,
  **Commit and push**, **Discard and dispose**. Commit and push commits the
  shown files with a generated message and pushes; the row then re-triages.
- **Row menu (…):** Keep / Un-keep, Dispose anyway (red), Open in Finder,
  Open in terminal, Copy path.

## Testing

- **Daemon, one fixture repo per catalog state** (the twelve rows on
  `state-catalog-*.png`): assert `group`, `push`, `containment`, `dirt.kind`
  and `actions` for each. Includes the lockfile-only diff, the untracked
  build-output directory, the rebased-then-merged branch and the
  gitdir-gone tree.
- **Guard tests:** `triage-dispose` refuses on a stale fingerprint, refuses
  `discard: "all"` on a `safe` row and any discard on `only-copy` without
  `confirmOnlyCopy`, and never removes a path it didn't classify.
- **Keep:** a new commit, a new dirty file, or an MR state change each
  un-keep the tree.
- **Summary sweep:** fires once per day after 09:00, never at zero, not
  again after a restart the same day.
- **Swift:** panel-model tests for grouping, counts, and the bulk button's
  per-row reporting.
- **Visual:** render the panel in both schemes and compare against the
  boards by eye before calling the tray milestone done.

## Out of scope

- Changing when the reactor or stale sweep dispose on their own. This panel
  only surfaces and acts on what they left.
- Worktrees of repos rt doesn't manage.
