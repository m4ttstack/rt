# Codeowner section alarm

Make a codeowners tab whose configured section no longer exists in the
project's CODEOWNERS say so, loudly, instead of showing a clean empty queue.

## Problem

A codeowners tab is populated by exact-name matching: the rt daemon sweeps
each open MR's approval rules and tags the MR with every demanded section
whose `CODE_OWNER` rule is unapproved (`lib/daemon/project-sync.ts`,
`sectionsMatching`). The tab's section name comes from `board.tabs` in the
team settings store.

On 2026-08-31 a commit to the tracked project renamed every CODEOWNERS section
to carry its pod's Slack channel, so `[Acme]` became `[Acme - #pod-acme]`.
GitLab's per-MR rules picked up the new header; the board's config still said
`Acme`; the next deep sync matched nothing and replaced the tag table with an
empty one. The Codeowner Queue tab rendered "nothing waiting on review ✓"
while 18 MRs were waiting under the new name. Every teammate sharing the team
store saw the same empty tab.

Nothing in the pipeline could tell a wrong name from an empty queue:

- `scope.uncoveredSections` means "demanded but not yet swept". Once swept, a
  section is "covered" whether or not it matched anything.
- The board's empty state is the same paragraph for every reason a tab has no
  rows.
- The tab editor accepts any string as a section.

The immediate remedy was applied by hand on 2026-09-02: `board.tabs` in the
team store now names the new section (unpublished). This spec is the guard
against the next rename.

## Solution

The daemon reports the section headers of the project's default-branch
CODEOWNERS file beside its scope, as `knownSections`. The board compares each
codeowners tab's configured section against that set and, when it is absent,
replaces the empty state with an error banner that names the missing section
and the closest known one, marks the tab in the strip, and hints in the tab
editor. Three repos change: glance (the fetch), rt (store and wire), board
(the surfaces).

### Why the CODEOWNERS file, not the rules sweep

The rules sweep already sees section names, but GitLab snapshots code-owner
rules per MR when it syncs the MR. Stale MRs keep old headers: on 2026-09-02
two open MRs in the tracked project still carried an approved `Acme` rule
alongside 18 carrying the new name. A known-set built from the sweep would contain both
names and never fire for this incident. Counting only unapproved rules fixes
that case but false-alarms on a healthy section whose queue happens to be
fully approved.

The default-branch CODEOWNERS file is the authoritative list of sections that
new MRs will match. One GraphQL query returns it: `project { repository {
blobs(paths: [...]) { nodes { path rawTextBlob } } } }` with no `ref`, which
GitLab resolves to the default branch. Verified against the tracked project:
42 headers, exactly one containing the old name.

The rules sweep and exact-name tagging stay as they are. A stale MR carrying an
old unapproved rule is genuinely waiting on that old rule, and tagging it by
its own snapshot is correct.

### `knownSections` semantics

| Value | Meaning |
|---|---|
| `string[]` | Section headers on the default branch, verbatim text between the brackets, trimmed, de-duplicated, sorted |
| `[]` | The project has no CODEOWNERS file, or one with no sections |
| absent | The daemon predates this field, or no deep or backfill has run since a section was demanded |

The board treats absent as "cannot judge" and shows today's behaviour. It
never alarms on absent.

Header text is kept as written. GitLab compares section names
case-insensitively for ownership, but the approval rule's `section` carries
the header text and the board's tag match is exact, so the known set is exact
too. Case only enters the suggestion heuristic (below).

## glance

`GitLabProvider` gains one method, GitLab-only like `fetchApprovalRules`:

```ts
fetchCodeownerSections(options: { projectPath: string }): Promise<string[] | null>
```

- One `runQuery` call with the three documented locations, in GitLab's
  precedence order: `CODEOWNERS`, `docs/CODEOWNERS`, `.gitlab/CODEOWNERS`.
  The first path present wins; the others are ignored even if present.
- Returns `null` when no location exists, else `parseCodeownerSections(text)`.
- No pagination, no `ref`.

`parseCodeownerSections(text: string): string[]` is a pure exported function
next to the provider:

- A header is a line whose first non-blank character is `[`, or `^[` for an
  optional section. The name is the text up to the first `]`, trimmed.
- An approvals count suffix (`[Name][2]`) and trailing default owners
  (`[Name] @owner`) are ignored.
- Comment lines (`#`) and blank lines are skipped. A `[` inside a path rule
  is not a header because the line does not start with it.
- Output is de-duplicated case-insensitively, keeping the first casing seen
  (GitLab merges same-named sections that way), then sorted.

Tests, `tests/gitlab-codeowner-sections.test.ts`, stub `runQuery` the way
`tests/approval-rules.test.ts` does: precedence when two locations exist,
`null` on none, and the parser cases above including a name with spaces and a
`#` inside the brackets (the pod channel form).

Ships as glance 0.22.0 with a CHANGELOG entry, published from `main`.

## rt

### Store

The scope JSON in `project_mrs_meta.scope` gains an optional `knownSections`:

```ts
scope?: { authors: string[]; sections?: string[]; windowDays: number; knownSections?: string[] }
```

`setScope`'s parameter type widens to match. No schema migration: the column
is JSON.

### Sync

`ProjectSyncOverrides` gains a seam like `fetchRules`:

```ts
fetchKnownSections?: (repoName: string) => Promise<string[] | null>;
```

Its default resolves the provider through `getRepoContext` and calls
`fetchCodeownerSections`. `null` is stored as `[]`.

- **Deep**, inside the existing `if (sections.length > 0)` block: fetch, and
  carry the result into the `setScope` call. On failure, log a warning
  (`codeowner sections fetch failed`) and carry the previous
  `record.scope.knownSections` instead. The deep's `setScope` currently
  rebuilds the scope object, so it must pass `knownSections` explicitly or
  the value is lost.
- **backfillSections**: same fetch and same fallback, spread into the scope it
  already rewrites. This is what makes a fix in the tab editor refresh the set
  immediately: the board re-declares the new section, the read handler sees it
  uncovered, and the backfill runs.
- **backfillAuthors** rebuilds the scope through `setScope` too. It does not
  fetch, but it carries the stored `knownSections` forward the same way it
  already carries `sections`, or a new author demand would blank the list
  until the next deep.
- **Delta** never touches it. Containment holds: a repo with no demanded
  sections never fetches.

A failed fetch never clears a stored value, so a flaky call cannot produce a
false alarm.

### Wire

`project-mrs:read` already spreads `record.scope` into its response, so the
field flows without a handler change. `packages/rt-client/src/commands.ts`
adds to `ProjectMRsScope`:

```ts
/** Section headers in the default-branch CODEOWNERS at the last deep or
    backfill. `[]` when the project has none. Absent from a pre-knownSections
    daemon or before the first sweep that demanded a section. */
knownSections?: string[];
```

rt-client bumps to 0.11.1, rebuilt with `bun run build` so
`dist-freshness.test.ts` passes, published from `main` per the CLAUDE.md
rule. repo-tools bumps its glance dependency to `^0.22.0`.

### Tests

In `lib/daemon/__tests__/project-sync.test.ts`, alongside the sections tests:

- deep with a sections demand records `knownSections` from the seam
- deep whose seam throws keeps the previous `knownSections` and still
  completes the sync
- deep whose seam returns `null` stores `[]`
- `backfillSections` records `knownSections`
- containment: a demand without sections never calls the seam

After merge the dev daemon is restarted so the running process picks up the
code.

## board

### Server

`SyncScopeRead.scope` in `src/data.ts` gains `knownSections?: string[]`.
`aggregateSyncScope` returns one more field:

```ts
scopeKnownSections: string[] | null
```

It is the sorted union across every project read that carried the field, and
`null` when none did. The snapshot, `/data.json`, and `src/client/types.ts`
carry it through unchanged.

### Shared helper

`src/sections.ts`, imported by both the client and the server tests:

```ts
export function sectionStatus(
  section: string,
  known: string[] | null,
): { unknown: boolean; suggestion: string | null }
```

- `unknown` is `known !== null && !known.includes(section)`.
- `suggestion`, computed only when unknown: the first known entry whose
  lower-cased text starts with the lower-cased configured section; else the
  first whose lower-cased text contains it; else `null`.

### Client surfaces

**Tab content.** `Board.tsx` computes `sectionStatus` for the active
codeowners tab. When unknown, the empty-state paragraph is not rendered and
the `syncing` chip is suppressed; in their place a banner with a bad intent
modifier on the existing `tui-banner` class reads:

> ⚠ no CODEOWNERS section "Acme" · did you mean "Acme - #pod-acme"?
> [fix in settings]

Without a suggestion the sentence ends after the section name. The button
calls the existing `openConfig`. Rows can still appear under the banner: an
MR whose per-MR rules still carry the old name stays tagged until GitLab
re-syncs it, and it genuinely waits on that old rule, so the banner sits
above the list rather than replacing it. Only the empty-state paragraph is
suppressed.

**Tab strip.** `TabBar` takes `unknown: string[]`, the ids of tabs whose
section is unknown, and renders `<Chip intent="bad">no such section</Chip>`
after each such tab's label, active or not. When a tab is both unknown and
syncing, only the unknown chip shows.

**Tab editor.** `ConfigModal` takes `knownSections: string[] | null`.
`TextField` gains an optional `suggestions?: string[]` that renders a
`<datalist>` and sets `list` on the input. Both section fields (each existing
tab's, and the new-tab field) pass the known set. Under an existing tab's
section field, when `sectionStatus` says unknown, a one-line hint reads
`not in CODEOWNERS · did you mean "…"?` in the bad text colour. The tabs help
copy gains a sentence saying a section must match a CODEOWNERS header
exactly.

### Tests and capture

- `src/__tests__/board.test.ts`: `aggregateSyncScope` yields `null` when no
  read carries the field and the sorted union when some do.
- `src/__tests__/sections.test.ts`: exact match is not unknown; `null` known
  is never unknown; prefix suggestion; contains suggestion; no suggestion.
- Capture: `tests/fixture/data.json` gains `scopeKnownSections` listing its
  existing tab sections plus one new codeowners tab whose section is not in
  the set. Baselines are regenerated (the strip now carries the chip, a real
  change to the visual contract) and one new state, `badsection`, clicks that
  tab and shoots the banner in both themes.

Dependencies: `@mattstack/rt-client` to `^0.11.1`. Deploy is the manifest's
`bun run build && deck restart board`.

## Sequencing

1. **glance**: branch, method plus parser plus tests, CHANGELOG, PR, merge,
   publish 0.22.0. Needs Matt's OTP.
2. **rt**: `rt worktree provision`, bump glance, store and sync and wire
   changes with tests, rt-client 0.11.1, PR, merge, publish rt-client from
   `main` (OTP), restart the daemon.
3. **board**: this worktree, bump rt-client, server and client changes with
   tests, regenerate capture baselines, PR, CodeRabbit and CI green, deploy.

The board tolerates an older daemon (absent field, no alarm), so the order
only matters for the feature to light up, not for safety.

## Out of scope

- Tolerant section matching in the daemon (a `" - #channel"` suffix
  heuristic). Decided against: exact match is what GitLab reports, and the
  alarm plus suggestion covers the rename case.
- A Slack post guard for a tab whose section is unknown.
- Naming the project in the banner when a board spans several projects; the
  known set is a union and the message stays project-agnostic.
- Publishing the team store change. That is a manual `rt team publish` when
  Matt chooses.
