# Apps Fold-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold all five apps (chat, console, boxscore, board, deck) into this repo as workspace consumers, rename the repo to `m4ttstack/apps`, and end npm publishing of the platform packages.

**Architecture:** One PR per app, sequential (chat, console, boxscore, board, deck), each a merge-commit PR carrying: subtree import with history, workspace wiring, that app's ex-Phase 3 cleanup, workflow disposition, and bounded CI steps. Then a cutover task (rename, rt identity, max's bundle brief) and a gated archive checklist. The spec carries the precise constraints; every task below binds to it.

**Tech Stack:** Bun workspaces, git subtree, per-app vite/tsc/bun builds, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-06-apps-fold-in-design.md` (executors read it; its Bundle pipeline and Per-app migration sections are normative for every task here).

## Global Constraints

- Fold-in PRs merge with MERGE COMMITS, never squash (history preservation).
- Subtree imports come from each app repo's `origin/main` only; anything unmerged in an app repo lands there first or waits.
- Platform deps become `workspace:*`. Shared external deps align via a root workspace CATALOG (Bun: `workspaces.catalog` in the root package.json; members reference `"catalog:"`; `bun pm pack` resolves refs to concrete versions at pack time, so transition tarballs stay valid). Task 2 introduces the catalog with at least: react `^19.2.7`, react-dom `^19.2.7`, the nine `@mantine/*` at `^9.5.2`, wouter, zod, hono, `@mattstack/rt-client` `0.16.0`, `@mattstack/glance`, typescript, vite, vitest, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `@tanstack/react-query`. Each fold-in converts that app's occurrences of catalogued deps to `catalog:` (board's `19.2.7` and deck's `19.2.8` exact react pins die here); deps not in the catalog keep their pins. Every app task still verifies single-React resolution (`bun pm ls react` reachable once, or the app's duplicate-react guard passes).
- tui-kit exports `./dist/*`: root scripts and CI run `tui-kit:build` before ANY board or deck typecheck/test/build step. Mantine apps are exempt.
- Ex-Phase 3 cleanups are fragments only, per the spec's step 3 (survive-lists and commit anchors ed4b81c, 7c531fa, 273fcaf, e18a4b7); board's text-role swap: text `color:` declarations move to `var(--muted-text)` / `var(--accent-text)` / `var(--red-text)`, fills and dots keep `var(--muted)`.
- No imported `.github/workflows` stays inert: port (console/board purity gates, chat's served-client/api-404 gate) or delete (board/deck release.yml) in the same PR.
- Never use em dashes in authored text; comments state constraints only.
- No npm publish anywhere, ever. `mattstack.deck.json` files are imported, never authored.
- Each app keeps its own `version` field, scripts, ports, and URL contracts (chat.localhost's `/r/<room>#m-<id>` links unchanged).
- Old app repos are hotfix sources of truth until their bundle cutover: if an old repo's main moves after import, `git subtree pull` re-syncs before that app's cutover.
- Execute in the rt worktree; the plan's SDD workspace continues `.superpowers/sdd/2026-09-06-apps-fold-in/`.

---

### Task 1: Truth repairs and probe retirement prep

**Files:**
- Modify: `README.md` (consumption story), `CLAUDE.md` (publishing inversion, consumer-repos section describes `apps/`), root `package.json` (no script changes yet)

**Interfaces:**
- Produces: docs that stop claiming npm resolvability (0.4.0 is unpublished; CodeRabbit-verified false today).

- [ ] **Step 1**: README: Installation section rewritten: apps live in this repo and consume the workspace; the packages are not published; the packed-tarball subsection survives only as the bundle-transition mechanism with a one-line pointer at the spec. Remove the `^0.4.0` npm snippets.
- [ ] **Step 2**: CLAUDE.md: Publishing section states nothing publishes and the four 0.4.0 versions are tree-internal identities; Reading order and consumer sections point at the fold-in spec; consumer-repos list replaced by the apps/ description (chat first, others "arriving per the fold-in plan").
- [ ] **Step 3**: Run `bun run format:check` and `bun run lint`; commit `docs: consumption truth repair (nothing publishes)`.

### Task 2: Fold in chat

**Files:**
- Create: `apps/chat/**` (subtree from `~/Documents/GitHub/chat`, origin/main)
- Modify: root `package.json` (workspaces gains `apps/*`; scripts gain `chat:*`), `.github/workflows/ci.yml`, `apps/chat/package.json`, `apps/chat/src/app/styles/type-scale.css`, `bun.lock`
- Delete: `apps/chat/.github/` (after porting), `probe/` (chat replaces it as the in-repo proof), probe scripts and CI steps in root `package.json` + ci.yml

**Interfaces:**
- Produces: the `apps/*` workspace pattern, root script conventions `chat:typecheck`, `chat:test`, `chat:lint`, `chat:build` (`cd apps/chat && bun run <script>`), and the per-app CI step shape every later task copies.

- [ ] **Step 1**: `git fetch` the chat repo, then `git subtree add --prefix apps/chat ~/Documents/GitHub/chat main`.
- [ ] **Step 2**: Root `package.json`: workspaces becomes the OBJECT form with the catalog:

```json
"workspaces": {
  "packages": ["packages/*", "packages/tui-kit/workshop", "apps/*"],
  "catalog": {
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "@mantine/code-highlight": "^9.5.2",
    "@mantine/core": "^9.5.2",
    "@mantine/dates": "^9.5.2",
    "@mantine/form": "^9.5.2",
    "@mantine/hooks": "^9.5.2",
    "@mantine/modals": "^9.5.2",
    "@mantine/notifications": "^9.5.2",
    "@mantine/spotlight": "^9.5.2",
    "@mattstack/glance": "^0.24.0",
    "@mattstack/rt-client": "0.16.0",
    "@tanstack/react-query": "^5.102.0",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.3",
    "hono": "^4.13.3",
    "typescript": "~6",
    "vite": "^8.1.1",
    "vitest": "^4.1.10",
    "wouter": "^3.10.0",
    "zod": "^4.4.3"
  }
}
```

Convert the ROOT devDependencies and each workspace package's occurrences of these deps (packages/ui peers included; catalog refs work in peerDependencies) to `"catalog:"` in this same step, so the catalog is the single home from its first commit. Then `apps/chat/package.json`: `@mattstack/app-kit`, `@mattstack/app-server`, `@mattstack/mantine-tokyo` -> `"workspace:*"`; every catalogued dep -> `"catalog:"`. `bun install`; verify single React (`bun pm ls react`); `bun run tui-kit:gates` and the full root suite prove the catalog conversion changed no resolution the gates can see.
- [ ] **Step 3**: Ex-Phase 3 fragment cleanup per the spec (type-scale.css trailing smoothing section only; anchor 7c531fa). Chat's `loading-bar-sync.test.ts` must still pass (the index.html block it byte-compares is untouched).
- [ ] **Step 4**: Workflow disposition: port chat's served-client/api-404 gate from `apps/chat/.github/workflows/ci.yml` into root ci.yml as chat steps (`chat:typecheck`, `chat:lint`, `chat:test`, `chat:build`, plus the served-client check command verbatim); `git rm -r apps/chat/.github`.
- [ ] **Step 5**: Probe retirement: `git rm -r probe`, remove `probe:*` root scripts and their ci.yml steps and the `sync-probe-refs` script; chat's suite is the in-repo consumer proof now.
- [ ] **Step 6**: Full verification: root typecheck/lint/format:check/test, `tokens:test`, `tui-kit:gates`, `chat:*` suite, `build-storybook`, `treeshake`. All green.
- [ ] **Step 7**: Commit(s) as logical units (subtree commit stands alone; wiring; cleanup; probe retirement). Open PR `apps: fold in chat`; MERGE COMMIT on approval.

### Task 3: Fold in console

Same shape as Task 2 (no probe step). Specifics that differ:

- [ ] Subtree from `~/Documents/GitHub/console` into `apps/console`.
- [ ] Deps: three kit packages -> `workspace:*`; rt-client already `0.16.0` exact, keep; react `^19.2.7` stays.
- [ ] Fragment cleanup: remove ONLY the two smoothing declarations inside index.html's inline style block; the loading-bar rules stay (anchor ed4b81c); console's `loading-bar-sync.test.ts` still green.
- [ ] Workflow disposition: port console's ci.yml steps and its purity gate (`purity.yml` + `scripts/repo-purity.sh`) as `console:*` steps; delete `apps/console/.github`.
- [ ] Verification + PR `apps: fold in console`; merge commit.

### Task 4: Fold in boxscore

Same shape. Specifics:

- [ ] Subtree from `~/Documents/GitHub/boxscore` into `apps/boxscore`.
- [ ] Deps: kit packages -> `workspace:*`; `@mattstack/settings-kit` stays pinned as-is; rt-client -> `0.16.0`.
- [ ] No fragment cleanup (boxscore has no local copies).
- [ ] Workflow disposition per its repo's actual workflows (inventory at import; port test/typecheck steps, delete the rest deliberately).
- [ ] Not in the mac bundle: no recipe concerns. Old repo may archive after merge (spec sequencing note).
- [ ] Verification + PR `apps: fold in boxscore`; merge commit.

### Task 5: Fold in board

**The deepest one.** Same shape plus:

- [ ] Subtree from `~/Documents/GitHub/board` into `apps/board`.
- [ ] Deps: `@mattstack/tui-kit` -> `workspace:*`; rt-client `0.16.0` exact stays; glance/settings-kit/invadrs pins stay; react exact `19.2.7` -> `^19.2.7` (workspace alignment); verify single React especially here (board's `//soribashi` note documents the two-copy failure).
- [ ] Build ordering: add `tui-kit:build` before every `board:*` step in root scripts and CI.
- [ ] Fragment cleanup per spec step 3 (anchor 273fcaf): the one body smoothing block AND the `:root` override block in `src/style.css`, plus the text-role swap (text `color:` declarations to the `-text` vars; fills and dots keep `var(--muted)`). Board's capture baselines will move: re-baseline (`capture:baseline`) deliberately and eyeball before committing baselines.
- [ ] Workflow disposition: port board's purity gate; delete its release.yml (subsumed by bundle-apps).
- [ ] rt/board automation: update board's skills and state paths that reference the repo location (inventory `rg -l 'Documents/GitHub/board|m4ttstack/board'` across board's own tree and mattstack-skills; changes outside this repo land in their own homes and are listed in the task report, not made silently).
- [ ] Verification (board's own `bun test`, typecheck, captures) + PR `apps: fold in board`; merge commit.

### Task 6: Fold in deck

Same shape plus:

- [ ] Subtree from `~/Documents/GitHub/deck` into `apps/deck`.
- [ ] Deps: `@mattstack/tui-kit` -> `workspace:*`; react exact `19.2.8` -> `^19.2.7`-aligned single resolution; rt-client -> `0.16.0`; glance stays.
- [ ] Build ordering: `tui-kit:build` before `deck:*` steps.
- [ ] Fragment cleanup (anchor e18a4b7): smoothing declarations inside `core/board/board.css`'s body rule; regenerate `core/generated/board.css` via `build:board`.
- [ ] Workflow disposition: delete deck's release.yml (subsumed); port its test steps as `deck:*`.
- [ ] Deck service registrations repoint to `apps/deck` paths (deck's own registry entries for the estate's apps also gain the new cwd/commands for chat/console/boxscore/board as those are already folded; do this via the `deck` CLI, listed in the report).
- [ ] Verification (deck's `bun run test`, `test:dom`, captures) + PR `apps: fold in deck`; merge commit.

### Task 7: Cutover: rename, rt identity, bundle brief

- [ ] **Gate: Matt confirms the rename moment.** Then rename the GitHub repo to `m4ttstack/apps` (`gh repo rename`); update local remotes, rt identity/worktree registration, the chat-room derivation, and any in-repo self-references to `m4ttstack/app-kit`.
- [ ] Write max's brief (a doc in this repo, `docs/bundle-cutover-brief.md`): the six pipeline changes from the spec's Bundle pipeline section, the per-app `apps/<name>/mattstack.deck.json` paths, app-prefixed tag scheme, deps.lock slug repoints, the unarchive rule, and the NPM_READ_TOKEN residual scope. Deliver via rt chat to max; the rt-repo changes are max's to land.
- [ ] Old repos: add README pointers to `apps` on chat/console/board/deck (boxscore may archive now); NOTHING archives or privatizes yet.
- [ ] Public-link repoint pass: mattstack.dev and sibling READMEs that link deck's repo get an issue/note listed for Matt (deck privatization happens only after the deps.lock cutover ships).

### Task 8: Post-cutover gated checklist (blocked on max's pipeline changes + a shipped mattstack.app release)

- [ ] After a mattstack.app release ships with deps.lock pointing at `apps` release tarballs: deck's old repo goes private, then chat/console/board/deck old repos archive.
- [ ] Close out: MAT-413 and this initiative's tickets updated; the SDD workspaces for both plans deleted; memory updated.

---

## Verification summary

- Every fold-in PR: that app's own suite green in-repo, root suite green, single-React verified, CI green on the PR, CodeRabbit findings triaged per Matt's flow.
- After Task 6: `bun install` from clean checkout + `tui-kit:build` + all app suites green proves the workspace is self-contained with npm needed only for external packages.
- Cutover safety: nothing archived or privatized until Task 8's gate; old-tag rebuilds keep working throughout.
