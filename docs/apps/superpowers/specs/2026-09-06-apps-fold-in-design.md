# apps fold-in: one repo for the estate, npm retired

Date: 2026-09-06. Status: approved direction, spec under review.
Builds on `2026-09-05-ui-platform-monorepo-design.md` (phases 1-2 shipped,
merged as PRs #11/#13) and SUPERSEDES that plan's Phase 3.

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
| What stays npm | `@mattstack/rt-client`, `@mattstack/glance`, `@mattstack/settings-kit`, `invadrs`: external packages with their own homes and trains, consumed by the apps exactly as today (exact pins preserved). |
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

1. Per-app recipe keying: one `recipe.json` per app (at
   `apps/<name>/recipe.json`) or a keyed root recipe; `plan-matrix.ts`
   and `bundle-apps.yml` updated accordingly.
2. Version read from `apps/<name>/package.json`, not the repo root.
3. App-prefixed tags (`chat-v0.1.1`) with the tag guard and release
   step updated; releases land on `m4ttstack/apps`.
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

1. `git subtree add --prefix apps/<name>` from the app repo's main.
2. Workspace wiring: platform deps become `workspace:*`; external npm
   deps keep their exact pins; the app's vite/tsc/bun build runs from
   `apps/<name>` unchanged; root scripts and CI gain bounded per-app
   steps (the app's own typecheck/test/lint, not a root sweep).
3. Ex-Phase 3 cleanup in the same PR: delete the app's local smoothing
   copy (console index.html inline block, chat type-scale.css, board
   style.css, deck board.css); board additionally deletes its :root
   override block and swaps text-role `color:` declarations to
   `var(--muted-text)` / `var(--accent-text)` / `var(--red-text)`
   (fills and dots keep `var(--muted)`, which is the raw value).
4. `recipe.json` added for bundled apps (chat, console, board, deck).
5. Deck service registration repoints to the monorepo path; the old
   repo is left untouched (unarchived, per the pipeline rule) and gains
   a README pointer to `apps`.
6. rt identity: the session/worktree/chat keying for the app moves to
   the `apps` repo; board's skills and automation update their repo
   references.

## Rename and privatization sequencing

1. Fold-in PRs land under the current `app-kit` name.
2. After the last app lands: rename the repo to `m4ttstack/apps`
   (redirects preserve clones and PR links); update rt identity, the
   chat room derivation, deps.lock slugs (with max), and public links.
3. Deck's old repo goes private only after the deps.lock repoint ships
   in a mattstack.app release; the other four old repos likewise stay
   until then, then archive.

## Docs and truth repairs (first commit of the fold-in)

- README: the npm-first Installation section is false (0.4.0 never
  published; CodeRabbit-verified). Rewrite consumption as: in-repo apps
  use the workspace; anything external is not supported. The packed-
  tarball subsection survives only as the bundle-transition mechanism.
- CLAUDE.md: publishing section inverts (nothing publishes; the four
  0.4.0 versions are tree-internal identities); consumer-repos section
  describes `apps/` instead.
- Storybook's story glob is broken (`No story files found`); repair it
  in passing, it is the kit's eyeball surface.

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
