# Bundle cutover brief: rt side

For max, owner of `bundle-apps.yml` and the mac-app bundle pipeline. This
is the repo-side handoff for Task 7 of the apps fold-in
(`docs/superpowers/specs/2026-09-06-apps-fold-in-design.md`, "Bundle
pipeline" section). The repo-side rename and self-reference sweep are
done; everything below is rt-side work.

## What happened on the repo side

- GitHub repo renamed: `m4ttstack/app-kit` -> `m4ttstack/apps`.
  GitHub redirects are active, so old clone URLs and PR links keep
  working during the interim.
- All five apps now live at `apps/{chat,console,boxscore,board,deck}`
  in this one repo, each with its imported `mattstack.deck.json` at
  the app's own root (`apps/<name>/mattstack.deck.json`), not the
  repo root.
- Every app keeps its own `version` in `apps/<name>/package.json`.
  There is no shared version at the repo root.

## What changes on the rt side

**a. Recipe path.** `plan-matrix.ts` and `bundle-apps.yml` read the
per-app recipe from `apps/<name>/mattstack.deck.json` in the one repo,
not a root-level recipe. Nothing new needs authoring; the recipe files
already exist at those app roots.

**b. Version source.** Version reads come from `apps/<name>/package.json`,
not the repo root's package.json (the repo root has no meaningful
version for this purpose).

**c. Tags.** Tags become app-prefixed: `chat-v...`, `console-v...`,
`board-v...`, `deck-v...`. Update the tag guard and the release step to
match. The prefix is required, not cosmetic: chat and console both sit
at `0.1.0` today, so an unprefixed `v0.1.0` tag would collide on the
shared repo's first release. Releases land on `m4ttstack/apps`.

**d. deps.lock.** The `repo` field on each row repoints to the `apps`
slug. GitHub's redirects cover the interim, so this can land on its own
schedule rather than blocking on it.

**e. Old app repo archival.** Old app repos (chat, console, board,
deck) stay unarchived until a SHIPPED `mattstack.app` release carries a
`deps.lock` that has repointed to `apps` release tarballs. Archiving
early would brick rebuilds of older tags whose deps.lock still points
at the old repo. Boxscore is exempt from this gate: it has no
deps.lock row (it does not ship in the bundle) and can archive as soon
as its fold-in merges.

**f. NPM_READ_TOKEN.** The four platform packages (`@mattstack/app-kit`,
`@mattstack/app-server`, `@mattstack/mantine-tokyo`, `@mattstack/tui-kit`)
resolve in-workspace after fold-in; none of them need the registry
anymore. `NPM_READ_TOKEN` in each bundle leg's npmrc step stays only as
long as an app still depends on some other restricted-registry package.
Check whether any such external dependency remains before dropping the
token from a leg; if none remain for an app, drop the step.

**g. One-repo bare-clone invariant.** This still holds and is the
constraint everything above serves: a bundle leg clones `m4ttstack/apps`
at `main` (bare clone, no sibling checkouts), runs `bun install
--frozen-lockfile`, then `tui-kit:build` if the app needs `dist` output
from tui-kit (board and deck do; the Mantine apps consume ui/server/tokyo
as TS source and need no build step there), then runs the app's own
recipe build.

## CI bun pin

CI in this repo pins bun to `1.3.13` (`.github/workflows/ci.yml`).
Bundle legs should pin the same version so build artifacts stay byte
comparable between CI and the bundle pipeline.

## Not in scope here

Everything above is the rt-repo side of the cutover (max's scope). The
apps repo side (fold-in PRs, the rename itself, the self-reference
sweep) is done. Old-repo archival timing (item e) depends on max's
deps.lock repoint actually shipping in a release; ping the app-kit
side once that release goes out so the exempted repos (chat, console,
board, deck) can be archived.
