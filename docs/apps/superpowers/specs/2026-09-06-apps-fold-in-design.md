# apps fold-in: one repo for the estate, npm retired

Date: 2026-09-06. Status: approved direction, spec under review.
Builds on `2026-09-05-ui-platform-monorepo-design.md` (its Migration
steps shipped as PRs #11/#13) and SUPERSEDES Phase 3 of
`docs/superpowers/plans/2026-09-05-ui-platform-monorepo.md` (the
consumer-bump cleanups), which now happen inside each app's fold-in.

## Problem

The platform packages exist only for mattstack's own apps, yet every kit
change still rides a hand npm publish (OTP included) before any app can
see it. The apps ship as prebuilt binaries in mattstack.app, so npm
identity buys nothing: it is pure release friction. Matt's directive:
keep as many packages unpublished as possible; make the apps local
consumers.

## Decision summary (ratified by Matt, 2026-09-06)

| Question | Decision |
|---|---|
| Scope | ALL FIVE apps fold into the monorepo: chat, console, boxscore, board, deck. |
| Repo name | The repo renames to `m4ttstack/apps` (GitHub redirects cover old URLs). |
| Deck's public repo | Deck goes private inside the wall. Accepted consequence: its public links and the MAT-249 open-sourcing ambition for deck invert; public-facing links (mattstack.dev, READMEs) need repointing. |
| npm | Platform publishing ENDS. 0.4.0 is versioned in-tree but never publishes; no package of this repo ships to the registry again. `packages/tokens` stays private as before. |
| What stays npm | `@mattstack/rt-client`, `@mattstack/glance`, `@mattstack/settings-kit`, `invadrs`: external packages with their own homes and trains, consumed by the apps as today. Pins survive EXCEPT where one hoisted workspace makes skew dangerous: react/react-dom align workspace-wide at fold-in (board pins 19.2.7 exact, deck 19.2.8 exact, everything else ^19.2.7; one nested copy plus workspace-linked tui-kit peering the hoisted copy is the two-React trap board's own package.json note documents). Each app's fold-in PR verifies single-React resolution. rt-client skew (^0.14.0 vs exact 0.16.0) aligns to the exact pin the daemon owners chose. |
| Ex-Phase 3 | Each app's smoothing-copy deletion, board's override deletion and text-role swaps happen inside that app's fold-in migration, not as separate bump PRs. |
| probe/ | Retires. Five real in-repo apps prove the packages; probe and its CI legs are deleted. |
| Gate-kit (future) | With board and console as siblings, the headless gate kit becomes an internal workspace package (thora's brief factors this in). Minimum published surface is standing policy. |

## Target layout

```
m4ttstack/apps
  packages/   ui (app-kit), server, tokyo, tui-kit, tokens
  apps/       chat, console, boxscore, board, deck
  scripts/    set-platform-version.ts (kept for tree versioning), bundle recipes
  docs/       specs, plans
```

Apps consume packages via `workspace:*`. Each app keeps its own
`version` in its `package.json` (the bundle pipeline reads it) and its
own scripts, ports, and deck service registration (commands repoint to
`apps/<name>`; hostnames and URL contracts unchanged, including
chat.localhost's `/r/<room>#m-<id>` links).

## Bundle pipeline (constraints from max, verified against rt-tray/deps.lock, bundle-apps.yml, build.sh)

The mac app consumes prebuilt per-app GitHub release tarballs pinned by
url+sha in deps.lock; `build.sh` never builds apps and needs no change.
The invariant to preserve: every bundle-apps leg builds from a bare
clone of ONE repo at main, on a GitHub macos runner, with no sibling
checkouts. Folding therefore requires, in the rt repo (max's scope, a
separate brief):

1. Per-app recipe keying: the recipe file is `mattstack.deck.json`, and
   every app repo (boxscore included) already carries one at its root;
   it rides in with the subtree to `apps/<name>/mattstack.deck.json`.
   Nothing new is authored; `plan-matrix.ts` and `bundle-apps.yml`
   change to read it from the per-app path.
2. Version read from `apps/<name>/package.json`, not the repo root.
3. App-prefixed tags (`chat-v0.1.1`) with the tag guard and release
   step updated; releases land on `m4ttstack/apps`. The prefix is
   essential, not cosmetic: chat and console both sit at 0.1.0 today,
   so unprefixed `v0.1.0` tags collide on the shared repo's first
   release.
4. deps.lock `repo` fields repoint to the `apps` slug.
5. The old app repos stay UNARCHIVED until a shipped mattstack.app
   release carries a deps.lock pointing at `apps` release tarballs;
   archived repos with dead release urls would brick rebuilds of older
   tags.
6. The `NPM_READ_TOKEN` npmrc step in each leg stays only as long as an
   app still depends on a restricted registry package; after fold-in the
   platform packages resolve in-workspace, so the token serves only
   whatever external @mattstack deps remain restricted.

Boxscore does not ship in the bundle; its fold-in has no pipeline leg.

## Per-app migration shape (one PR per app, history preserved)

For each app, in order chat, console, boxscore, board, deck:

1. `git subtree add --prefix apps/<name>` from the app repo's
   origin/main. Fold-in PRs merge with MERGE COMMITS, never squash: a
   squash flattens the imported history the subtree exists to preserve.
2. Workspace wiring: platform deps become `workspace:*` (aligning
   react/react-dom per the decision table); root scripts and CI gain
   bounded per-app steps (the app's own typecheck/test/lint, not a root
   sweep). Build-ordering constraint for board and deck: tui-kit
   exports `./dist/*`, which a bare `bun install` does not build, so
   the root scripts and CI must run `tui-kit:build` before any board or
   deck typecheck/test/build step. The Mantine apps need no ordering
   (ui/server/tokyo export TS source).
3. Ex-Phase 3 cleanup in the same PR, fragments only, never whole
   files: console deletes the two smoothing declarations inside its
   index.html inline style block (the loading-bar rules in that block
   stay; commit anchor ed4b81c); chat deletes the trailing smoothing
   section of `src/app/styles/type-scale.css` (the `--tk-fs-*` tokens
   stay; 7c531fa); board deletes its one `body` smoothing block and its
   `:root` override block in `src/style.css` (273fcaf) and swaps
   text-role `color:` declarations to `var(--muted-text)` /
   `var(--accent-text)` / `var(--red-text)` while fills and dots keep
   `var(--muted)`; deck deletes the smoothing declarations inside
   `core/board/board.css`'s body rule (e18a4b7) and regenerates its
   `core/generated/board.css` twin via `build:board`.
4. The app's imported `.github/workflows/` is dispositioned
   deliberately in the same PR: chat's served-client/api-404 gate and
   the purity gates (chat/console/board) port into the monorepo CI as
   per-app steps; board's and deck's tag-triggered release.yml are
   deleted (subsumed by bundle-apps); nothing stays inert under
   `apps/<name>/.github/`.
5. Deck service registration repoints to the monorepo path; the old
   repo is left untouched (unarchived, per the pipeline rule) and gains
   a README pointer to `apps`.
6. rt identity: the session/worktree/chat keying for the app moves to
   the `apps` repo; board's skills and automation update their repo
   references.
7. Drift window: until the bundle cutover, bundle builds still clone
   the OLD repo's main, so any interim hotfix lands there first and the
   monorepo copy re-syncs via `git subtree pull` before cutover. The
   old repo stays the hotfix source of truth for its app until its
   deps.lock row repoints.

## Rename and privatization sequencing

1. Fold-in PRs land under the current `app-kit` name.
2. After the last app lands: rename the repo to `m4ttstack/apps`
   (redirects preserve clones and PR links); update rt identity, the
   chat room derivation, deps.lock slugs (with max), and public links.
3. Deck's old repo goes private only after the deps.lock repoint ships
   in a mattstack.app release; chat, console, and board likewise stay
   until then, then archive. Boxscore has no deps.lock row and may
   archive as soon as its fold-in merges.

## Docs and truth repairs (first commit of the fold-in)

- README: the npm-first Installation section is false (0.4.0 never
  published; CodeRabbit-verified). Rewrite consumption as: in-repo apps
  use the workspace; anything external is not supported. The packed-
  tarball subsection survives only as the bundle-transition mechanism.
- CLAUDE.md: publishing section inverts (nothing publishes; the four
  0.4.0 versions are tree-internal identities); consumer-repos section
  describes `apps/` instead.
- Storybook stays the kit's eyeball surface; `build-storybook` is green
  on main and must stay green through every fold-in PR (an earlier
  broken-glob observation did not reproduce and is withdrawn).

## Risks

| Risk | Handling |
|---|---|
| CI time and blast radius grow with five apps in one repo | Start with bounded per-app steps; path-filtered jobs are the later lever. The absorbed suites are the same ones the app repos ran. |
| Repo-identity churn breaks automation (rt worktrees, board skills, chat handles) | Sequenced rename step with an explicit checklist; rt:repo-identity guidance applies; board's automation is the deepest and gets its own migration task. |
| Bundle transition bricks old-tag rebuilds | max's rule 5: nothing archives until a shipped deps.lock repoints. |
| A fold-in PR drags in an app repo's dirty or unpushed state | Each subtree imports the app repo's origin/main only; anything unmerged in an app repo lands there first or waits. |
| Deck privatization breaks public links | Enumerated repoint pass (mattstack.dev, sibling READMEs) in the rename step. |

## Out of scope

- Gate-kit design (thora's brief; lands later as an internal package).
- Rail/one-app consolidation of the Mantine apps.
- tui-kit-to-Mantine convergence.
- Any change to rt-client, glance, settings-kit, invadrs, or their repos.
