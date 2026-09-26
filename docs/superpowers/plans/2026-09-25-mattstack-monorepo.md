# mattstack monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `m4ttstack/rt` absorbs `m4ttstack/apps`, `m4ttstack/glance` and `m4ttstack/gitq` so rt-client, settings-kit and glance stop being registry publishes and the apps build in-tree at the release SHA.

**Architecture:** rt stays the root package; apps' `apps/*` and `packages/*` land at the same paths, glance under `packages/`, gitq under `apps/gitq`. One `bun.lock`, one catalog, Turborepo at the root for the apps and packages, rt's own unit suite untouched. The release builds the bundled apps in a job that holds no signing key and lands them where `fetch-deps.sh` used to; deps.lock keeps the app rows as deck's served-app catalog with `source: "tree"` instead of a download.

**Tech Stack:** Bun 1.4.2 workspaces, Turborepo 2.11, git-filter-repo, GitHub Actions (ubuntu + macOS), bash for the bundle scripts.

**Spec:** `docs/superpowers/specs/2026-09-25-mattstack-monorepo-design.md`

Three stages, each one PR that leaves `main` releasable, in this order: A apps (Tasks 1 to 13), B glance (Tasks 14 to 17), C gitq (Tasks 18 to 21). A stage's cutover task is Matt-gated; do not start the next stage's import until the previous stage's release has shipped.

## Global Constraints

- Bun `1.4.2` everywhere (`packageManager`, every `setup-bun` step); deck's byte-compared artifacts depend on it.
- rt code style: double quotes, no semicolons dropped, two-space indent. Apps, glance and gitq keep their own style (single quotes); never reformat one repo's code with the other's rules.
- No em dashes or en dashes anywhere, including comments and workflow text.
- Comments state constraints the code cannot show; never task numbers, rulings or history.
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never run a built `rt` binary outside `env -i HOME=<temp>`; never rebuild `/Applications/mattstack*.app` in place.
- `bun test` runs from the repo root (or an app's own directory under turbo); rt's unit suite is `bun run test`.
- The repo name stays `m4ttstack/rt`; nothing in this plan renames it.
- rt-client and settings-kit become `private`; glance, glance-react and gitq keep a publishable name and version and publish only with `bun publish`.
- No per-app version bumps: the mattstack.app tag versions everything.
- The job that imports the Developer ID certificate never runs app code.

## Review Focus

1. A PR that changes only `apps/board/src/**` must not run rt's macOS shards and must run board's turbo tasks. Pinned by Task 5's test-scope test.
2. A deps.lock row with `source: "tree"` that still carries `url` or `sha256`, or a fetched row missing them, must be rejected by `parseDepsLock`. Pinned by Task 6's bundle-layout tests.
3. `scripts/fetch-deps.sh` must skip a tree row with no network access and still download the tool rows. Pinned by Task 6's fetch-deps test.
4. A diff since the last tag that touches `apps/board/` and `lib/` together, or `apps/deck/` alone, must classify as full; `apps/board/` plus `RELEASE_NOTES.md` as fast. Pinned by Task 9's preflight tests.
5. `rt release app board` when `apps/board/` has not moved since the last tag must refuse before writing anything. Pinned by Task 10's release-app tests.
6. gitq's npm bundle must not import `@mattstack/rt-client` at runtime, since that package is no longer published. Pinned by Task 19's bundle test.

---

## File structure

Stage A creates or changes:

- `scripts/build-apps.ts` (new): builds every `source: "tree"` deps.lock row into `rt-tray/deps/arm64/`.
- `scripts/lib/deps-lock.ts`: `--source` filter, 12th TSV column.
- `lib/bundle-layout.ts`: `source` and `skills` fields, conditional required fields.
- `scripts/fetch-deps.sh`: skips tree rows.
- `rt-tray/deps.lock`: deck, board, console, chat, boxscore become tree rows.
- `scripts/ci/test-scope.ts`: apps trees are skippable for the unit shards.
- `.github/workflows/checks.yml`: turbo in `static`, new `deck-macos` job.
- `.github/workflows/release.yml`: new `build-apps` job, handoff into the release job.
- `lib/release/preflight.ts`: path gate; app, standalone-gitq and rt-client rows removed.
- `lib/release/release-app.ts`: qualify, notes, tag, verify; no bump, bundle or PR.
- `lib/release/update-machine.ts`: checkout-sync leg, deck re-register, verify against the tree.
- Root `package.json`, `turbo.json`, `scripts/turbo.sh`, `.gitignore`, `.prettierignore`, `eslint.config.mjs`, `test-setup.ts`, `scripts/repo-purity.sh`, `.github/renovate-global.json5`, `AGENTS.md`, `skills/rt-release/SKILL.md`.
- Deleted: `.github/workflows/bundle-apps.yml`, `scripts/bundle-ci/plan-matrix.ts`, `scripts/bundle-ci/update-lock.ts` and their tests, `apps/deck/src/cli/update.ts` and test, `apps/deck/scripts/install.sh`, the imported apps root config copies.

Stage B: `packages/glance`, `packages/glance-react`, `packages/typescript-config`, `docs/glance/`; root catalog and workspaces; `extensions/vscode/rt-context` joins the workspace.

Stage C: `apps/gitq`; its `package.json`, `scripts/release.ts`, a bundle test; deps.lock gitq row; preflight's standalone map; renovate.

---

## Stage A: apps

### Task 1: Import the apps repo with history

**Files:**
- Create: `apps/**`, `packages/{gate-kit,server,tokens,tokyo,tui-kit,ui}/**`, `docs/apps/**`, `apps/AGENTS.md`, `apps/CLAUDE.md`, `turbo.json`, `scripts/turbo.sh`, `scripts/set-platform-version.ts`, `scripts/__tests__/{helpers.ts,turbo-graph.test.ts,turbo-inputs.test.ts,turbo-sh.test.ts}`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `tsconfig.tools.json`, `vitest.config.ts`, `.storybook/**`, `stories/**`, `probe/**`, `docs/apps/root-{package.json,bunfig.toml,gitignore,bun-test-guard.ts,repo-purity.sh}`, `docs/apps/root-github/**`

**Interfaces:**
- Produces: the apps tree at its final paths, plus reference copies of apps' root config under `docs/apps/root-*` that Tasks 2 to 5 fold in and delete.

- [ ] **Step 1: Install git-filter-repo and clone apps main only**

```bash
brew list git-filter-repo >/dev/null 2>&1 || brew install git-filter-repo
SCRATCH="$(mktemp -d)/apps-import"
git clone --single-branch --branch main https://github.com/m4ttstack/apps.git "$SCRATCH"
git -C "$SCRATCH" for-each-ref --format='%(refname)' | grep -c archive/ || true
```
Expected: the last line prints `0` (the 62 archive refs stay behind).

- [ ] **Step 2: Drop the files rt already has, rename the rest into their monorepo homes**

```bash
cd "$SCRATCH"
git filter-repo --force --invert-paths --path CLAUDE.md --path LICENSE --path bun.lock
git filter-repo --force \
  --path-rename docs/:docs/apps/ \
  --path-rename README.md:docs/apps/README.md \
  --path-rename AGENTS.md:apps/AGENTS.md \
  --path-rename package.json:docs/apps/root-package.json \
  --path-rename bunfig.toml:docs/apps/root-bunfig.toml \
  --path-rename .gitignore:docs/apps/root-gitignore \
  --path-rename .github/:docs/apps/root-github/ \
  --path-rename scripts/bun-test-guard.ts:docs/apps/root-bun-test-guard.ts \
  --path-rename scripts/repo-purity.sh:docs/apps/root-repo-purity.sh \
  --path-rename eslint.config.js:eslint.config.mjs
git ls-files | grep -E '^(package.json|bunfig.toml|.gitignore|AGENTS.md|README.md|LICENSE|bun.lock|CLAUDE.md|eslint.config.js)$' || echo "root clean"
```
Expected: `root clean`. (`eslint.config.js` becomes `.mjs` because rt's root package.json has no `"type": "module"` and the config is ESM.)

- [ ] **Step 3: Merge into the branch with unrelated histories**

From the rt worktree:
```bash
git remote add apps-import "$SCRATCH"
git fetch apps-import main
git merge --allow-unrelated-histories --no-ff -m "monorepo: import m4ttstack/apps main with history" apps-import/main
git remote remove apps-import
git status --short | head
```
Expected: the merge completes with no conflicts and `git status --short` prints nothing. If it reports a conflict, a path collided; stop and report which, do not resolve by hand.

- [ ] **Step 4: Write `apps/CLAUDE.md`**

```
@AGENTS.md
```

Prepend to `apps/AGENTS.md`, above its title:

```markdown
> Scope: `apps/*` and the apps platform packages (`packages/gate-kit`,
> `packages/server`, `packages/tokens`, `packages/tokyo`,
> `packages/tui-kit`, `packages/ui`). rt's own contract is the root
> `AGENTS.md`; this file was the apps repo's before the fold-in.
```

- [ ] **Step 5: Commit**

```bash
git add apps/CLAUDE.md apps/AGENTS.md
git commit -m "apps: scope the imported AGENTS.md and add the CLAUDE.md pointer"
```

### Task 2: One workspace: root package.json, catalog, lockfile, ignore files, test preload

**Files:**
- Modify: `package.json`, `.gitignore`, `.prettierignore`, `test-setup.ts`, `turbo.json` (inputs only)
- Delete: `docs/apps/root-package.json`, `docs/apps/root-bunfig.toml`, `docs/apps/root-gitignore`, `docs/apps/root-bun-test-guard.ts`
- Test: `scripts/ci/__tests__/test-scope.test.ts` (existing parity tests keep passing)

**Interfaces:**
- Produces: root `workspaces.packages` = `["packages/*", "packages/tui-kit/workshop", "apps/*"]`; root `workspaces.catalog` as below; root scripts `apps:typecheck`, `apps:lint`, `apps:test`, `apps:build`, `check`, `purity`, `typecheck`, `lint:root`, `format`, `format:check`, and every apps per-app script verbatim from `docs/apps/root-package.json`.

- [ ] **Step 1: Rewrite the root `package.json`**

Replace the whole file with this. The catalog is apps' catalog minus `@mattstack/rt-client` and `@mattstack/settings-kit` (Task 3 makes those `workspace:*`), with `zod` raised to rt's floor and `@mattstack/glance` kept until Stage B.

```json
{
  "name": "repo-tools",
  "private": true,
  "license": "MIT",
  "packageManager": "bun@1.4.2",
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
      "@mattstack/glance": "^0.27.0",
      "@radix-ui/colors": "^3.0.0",
      "@tanstack/react-query": "^5.102.0",
      "@testing-library/react": "^16.3.2",
      "@types/css-tree": "^2.3.10",
      "@types/node": "^24.13.2",
      "@types/react": "^19.2.17",
      "@types/react-dom": "^19.2.3",
      "@vitejs/plugin-react": "^6.0.3",
      "css-tree": "^3.1.0",
      "hono": "^4.13.3",
      "typescript": "~6",
      "vite": "^8.1.1",
      "vitest": "^4.1.10",
      "wouter": "^3.10.0",
      "zod": "^4.6.5"
    }
  },
  "bin": {
    "rt": "./cli.ts"
  },
  "scripts": {
    "test": "bun test lib commands packages/rt-client packages/settings-kit packages/git-core scripts rt-tray/Tests/stub-rt rt-tray/vm/run/helpers",
    "test:watch": "bun run test --watch",
    "test:timings": "rm -f test-timings.json && bun run test --timings=test-timings.json --update-timings",
    "test:e2e": "bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/",
    "test:pty": "bun test --preload ./e2e/setup.ts --timeout 120000 e2e/pty/",
    "test:all": "bun run test && bun run test:e2e && bun run test:pty",
    "typecheck": "bunx tsc --noEmit",
    "docs:gen": "bun scripts/gen-docs.ts",
    "docs:check": "bun scripts/check-docs.ts",
    "picker:check": "bun scripts/lib/picker-conformance.ts",
    "docs:update": "bun scripts/update-docs.ts",
    "docs:deploy": "bash scripts/deploy-docs.sh",
    "purity": "scripts/repo-purity.sh",
    "postinstall": "bun run --cwd packages/rt-client build",
    "ui:build": "cd ui && CGO_ENABLED=0 go build -trimpath -ldflags \"-s -w -X main.version=${RT_VERSION:-dev}\" -o dist/rt-ui ./cmd/rt-ui",
    "ui:test": "cd ui && go vet ./... && go test ./...",
    "check": "scripts/turbo.sh check",
    "apps:typecheck": "scripts/turbo.sh typecheck",
    "apps:lint": "scripts/turbo.sh lint lint:root",
    "apps:test": "scripts/turbo.sh test",
    "apps:build": "scripts/turbo.sh build",
    "lint:root": "eslint --no-error-on-unmatched-pattern packages/gate-kit packages/server packages/tokens packages/tokyo packages/tui-kit packages/ui .storybook stories 'apps/board/src/**/*.css'",
    "format": "prettier --write . --cache",
    "format:check": "prettier --check . --cache",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build",
    "treeshake": "packages/ui/scripts/treeshake-check.sh",
    "tui-kit:build": "scripts/turbo.sh build --filter=@mattstack/tui-kit",
    "tui-kit:test": "scripts/turbo.sh test --filter=@mattstack/tui-kit",
    "tui-kit:oracles": "scripts/turbo.sh test:oracles --filter=@mattstack/tui-kit",
    "tui-kit:gates": "scripts/turbo.sh gates --filter=@mattstack/tui-kit",
    "tokens:test": "scripts/turbo.sh test --filter=@mattstack/tokens",
    "tokens:codegen": "bun run packages/tokens/scripts/generate.ts",
    "tokens:radix": "bun run packages/tokens/scripts/generate-radix.ts",
    "tokens:ramps": "bun run packages/tokens/scripts/generate-ramps.ts",
    "tokens:migrate": "bun run packages/tokens/scripts/migrate-tokens.ts",
    "tokens:fresh": "bun run tokens:radix && bun run tokens:codegen && bun run tokens:ramps && git diff --exit-code packages/tokens/src/radix.ts packages/tui-kit/src/generated packages/tui-kit/assets packages/tokyo/src",
    "gate-kit:test": "scripts/turbo.sh test --filter=@mattstack/gate-kit",
    "chat:typecheck": "scripts/turbo.sh typecheck --filter=chat",
    "chat:lint": "scripts/turbo.sh lint --filter=chat",
    "chat:test": "scripts/turbo.sh test --filter=chat",
    "chat:build": "scripts/turbo.sh build --filter=chat",
    "console:typecheck": "scripts/turbo.sh typecheck --filter=mattstack-console",
    "console:lint": "scripts/turbo.sh lint --filter=mattstack-console",
    "console:test": "scripts/turbo.sh test --filter=mattstack-console",
    "console:build": "scripts/turbo.sh build --filter=mattstack-console",
    "boxscore:typecheck": "scripts/turbo.sh typecheck --filter=boxscore",
    "boxscore:lint": "scripts/turbo.sh lint --filter=boxscore",
    "boxscore:test": "scripts/turbo.sh test --filter=boxscore",
    "board:typecheck": "scripts/turbo.sh typecheck --filter=board",
    "board:test": "scripts/turbo.sh test --filter=board",
    "board:build": "scripts/turbo.sh build --filter=board",
    "deck:test": "scripts/turbo.sh test --filter=deck",
    "deck:test-dom": "cd apps/deck && bun run test:dom"
  },
  "devDependencies": {
    "@chromatic-com/storybook": "^5.2.1",
    "@eslint/css": "^2.0.0",
    "@eslint/js": "^10.0.1",
    "@ianvs/prettier-plugin-sort-imports": "^4.7.1",
    "@mantine/code-highlight": "catalog:",
    "@mantine/core": "catalog:",
    "@mantine/dates": "catalog:",
    "@mantine/form": "catalog:",
    "@mantine/hooks": "catalog:",
    "@mantine/modals": "catalog:",
    "@mantine/notifications": "catalog:",
    "@mantine/spotlight": "catalog:",
    "@mattstack/app-kit": "workspace:*",
    "@mattstack/tokens": "workspace:*",
    "@mattstack/tui-kit": "workspace:*",
    "@storybook/addon-a11y": "^10.5.2",
    "@storybook/addon-docs": "^10.5.2",
    "@storybook/react-vite": "^10.5.2",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "catalog:",
    "@testing-library/user-event": "^14.6.1",
    "@types/bun": "^1.3.14",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "@xterm/headless": "^6.0.0",
    "eslint": "^10.7.0",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-storybook": "^10.5.2",
    "hono": "catalog:",
    "jsdom": "^29.1.1",
    "node-pty": "^1.1.0",
    "prettier": "^3.9.5",
    "react": "catalog:",
    "react-dom": "catalog:",
    "storybook": "^10.5.2",
    "turbo": "2.11.4",
    "typescript": "catalog:",
    "typescript-eslint": "^8.64.0",
    "vite": "catalog:",
    "vitest": "catalog:",
    "wouter": "catalog:",
    "zod": "catalog:"
  },
  "dependencies": {
    "@mattstack/glance": "^0.27.0",
    "@modelcontextprotocol/sdk": "1.30.0",
    "cli-highlight": "^2.1.11",
    "gitdiff-parser": "^0.3.1",
    "jsonc-parser": "^3.3.1",
    "pino": "^10.3.1",
    "pino-pretty": "^13.1.3",
    "pino-roll": "^4.0.0",
    "simple-git": "^3.36.0",
    "yaml": "^2.8.3"
  }
}
```

The dropped `peerDependencies.typescript "^5"` is replaced by the catalog's `~6`, which is what `bunx tsc` already resolved to on a machine with no typescript installed; `bun run typecheck` in Step 6 proves rt still checks under it.

- [ ] **Step 2: Fold the apps root test guard into `test-setup.ts`**

Read `docs/apps/root-bun-test-guard.ts`. It repoints `HOME` (rt's preload already does) and `BOARD_APP_ROOT`. Add to `test-setup.ts`, right after the existing `HOME` repoint line (search for `process.env.HOME =`):

```ts
// board's tests read BOARD_APP_ROOT for their state root; a bare root run must
// never reach the live board state any more than the live ~/.mattstack.
const testBoardRoot = mkdtempSync(join(tmpdir(), "mattstack-root-test-board-"));
process.env.BOARD_APP_ROOT = testBoardRoot;
```
and in the file's `afterAll` cleanup add `rmSync(testBoardRoot, { recursive: true, force: true });`. Then `git rm docs/apps/root-bun-test-guard.ts docs/apps/root-bunfig.toml`.

- [ ] **Step 3: Merge the ignore files**

Append to `.gitignore`:

```
# apps and packages (imported from the apps repo)
dist-ssr
*.local
storybook-static
*storybook.log
.turbo
FEEDBACK-*.md
packages/ui/scripts/treeshake-probe/dist
probe/src/server/embedded/manifest.ts
probe/dist-bin
probe/vendor
probe/bun.lock
docs/apps/design/gate-triage-modal/gate-triage-modal.html
```
Then `git rm docs/apps/root-gitignore`.

Replace `.prettierignore` with the apps version plus rt's own trees, so a root `prettier --write .` never touches rt code (single quotes would rewrite every rt file):

```
node_modules
dist
storybook-static
docs
bun.lock
packages/ui/scripts/treeshake-probe/dist
packages/tui-kit
apps/*/design
apps/board/skills/*/SKILL.md
apps/deck/core/generated
apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json
packages/tokens/src/radix.ts
packages/tokyo/src/ramps.ts
apps/*/state
apps/*/state.*
apps/*/src/server/embedded/manifest.ts
# rt's own code keeps rt's style (double quotes); prettier is the apps' tool
/cli.ts
/test-setup.ts
/test-timings.json
/tsconfig.json
/lib
/commands
/e2e
/scripts
/skills
/marketplace
/extensions
/website
/rt-tray
/ui
/packages/rt-client
/packages/settings-kit
/packages/git-core
/.github
/*.md
```

- [ ] **Step 4: Point turbo's global inputs at the merged root**

In `turbo.json` change `globalDependencies` to:
```json
"globalDependencies": ["tsconfig.tools.json", ".prettierrc", "bunfig.toml", "eslint.config.mjs", "test-setup.ts"]
```
and in `//#lint:root` inputs replace `"eslint.config.js"` with `"eslint.config.mjs"`. Remove the `"//#scripts:test"` task entirely (its tests now run inside rt's unit suite from `scripts/__tests__`).

- [ ] **Step 5: Install once and commit the single lockfile**

```bash
bun install
git rm docs/apps/root-package.json
bun install --frozen-lockfile
git status --short
```
Expected: `bun install --frozen-lockfile` exits 0; `git status` shows `bun.lock`, `package.json`, `.gitignore`, `.prettierignore`, `test-setup.ts`, `turbo.json` and the deletions, nothing else.

- [ ] **Step 6: Prove rt still checks and its suite still runs**

```bash
bun run typecheck
bun run test 2>&1 | tail -3
bun test scripts/ci/__tests__/test-scope.test.ts
```
Expected: tsc exits 0; the unit suite passes (the turbo tests imported into `scripts/__tests__` run too); test-scope's parity tests pass with the new `test` script.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock .gitignore .prettierignore test-setup.ts turbo.json docs/apps
git commit -m "monorepo: one workspace, one lockfile, apps' catalog and scripts at the root"
```

### Task 3: rt-client and settings-kit become workspace links, private

**Files:**
- Modify: `packages/rt-client/package.json`, `packages/settings-kit/package.json`, `apps/board/package.json`, `apps/boxscore/package.json`, `apps/chat/package.json`, `apps/console/package.json`, `apps/deck/package.json`, `packages/gate-kit/package.json`, `packages/server/package.json`, `bun.lock`
- Test: `packages/rt-client/test/dist-freshness.test.ts` (existing), turbo typecheck

- [ ] **Step 1: Switch every consumer to `workspace:*`**

In each of the seven consumer manifests, replace `"@mattstack/rt-client": "catalog:"` with `"@mattstack/rt-client": "workspace:*"` and, where present (board, boxscore, console), `"@mattstack/settings-kit": "catalog:"` with `"@mattstack/settings-kit": "workspace:*"`. Do it with one search:
```bash
grep -rln '"@mattstack/\(rt-client\|settings-kit\)": "catalog:"' apps packages --include=package.json
```
Expected before the edit: exactly those seven files. After: the grep prints nothing.

- [ ] **Step 2: Mark the two packages private**

In `packages/rt-client/package.json` and `packages/settings-kit/package.json` add `"private": true,` directly under `"version"`. Leave `files`, `exports`, `build` and `prepack` as they are: the consumers' `import` condition resolves `dist/`, which `postinstall` and turbo's `^build` produce.

- [ ] **Step 3: Reinstall and typecheck every consumer**

```bash
bun install
bun install --frozen-lockfile
scripts/turbo.sh typecheck --output-logs=errors-only
```
Expected: every package typechecks. A consumer that fails because it used a 0.31 export rt-client 0.32 renamed is a real finding: fix the consumer, never rt-client.

- [ ] **Step 4: Run the apps suite once**

```bash
scripts/turbo.sh test --filter=!deck --output-logs=errors-only
bun run test 2>&1 | tail -3
```
Expected: pass. (`deck` runs in Task 5's macOS job; run `scripts/turbo.sh test --filter=deck` locally on this Mac as well and expect pass.)

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/package.json packages/settings-kit/package.json apps/*/package.json packages/gate-kit/package.json packages/server/package.json bun.lock
git commit -m "monorepo: rt-client and settings-kit are private workspace packages"
```

### Task 4: Turbo owns the apps' gates and rt's static gates

**Files:**
- Modify: `turbo.json`, `scripts/turbo.sh`
- Test: `scripts/__tests__/turbo-sh.test.ts`, `scripts/__tests__/turbo-graph.test.ts` (existing, adjusted)

**Interfaces:**
- Produces: root tasks `//#typecheck`, `//#docs:check`, `//#picker:check` with inputs that exclude the apps trees, so an apps-only PR hits their cache; `scripts/turbo.sh check` runs them in its third phase.

- [ ] **Step 1: Add the three rt root tasks to `turbo.json`**

Insert into `tasks`, next to `//#purity`:

```json
"//#typecheck": {
  "inputs": [
    "cli.ts", "lib/**", "commands/**", "scripts/**", "e2e/**", "test-setup.ts", "tsconfig.json",
    "packages/rt-client/src/**", "packages/settings-kit/src/**", "packages/git-core/src/**",
    "!**/node_modules/**", "!**/dist/**"
  ]
},
"//#docs:check": {
  "inputs": ["cli.ts", "lib/**", "commands/**", "scripts/**", "website/docs/**", "!**/node_modules/**"]
},
"//#picker:check": {
  "inputs": ["lib/command-tree-def.ts", "lib/command-tree-resolve.ts", "scripts/lib/picker-conformance.ts", "commands/**"]
}
```

- [ ] **Step 2: Run them in `scripts/turbo.sh check`'s third phase**

Change the last invocation to:
```bash
bun "$turbo" run --cache-dir="$cache" lint:root format:check build-storybook treeshake purity typecheck docs:check picker:check test \
  --filter=// --filter=@mattstack/tokens \
  ${always_flags[@]+"${always_flags[@]}"}
```
(`scripts:test` is gone; `test` with `--filter=//` still runs nothing at the root because no `//#test` is declared, which is intended: rt's unit suite is the CI shards' and `bun run test`'s.)

- [ ] **Step 3: Update the turbo tests that pin the phase list**

Open `scripts/__tests__/turbo-sh.test.ts` and `turbo-graph.test.ts`; any assertion listing the third phase's tasks or expecting `//#scripts:test` changes to the new list. Run:
```bash
bun test scripts/__tests__/turbo-sh.test.ts scripts/__tests__/turbo-graph.test.ts scripts/__tests__/turbo-inputs.test.ts
```
Expected: pass.

- [ ] **Step 4: Run the full check once locally**

```bash
scripts/turbo.sh check --concurrency=4 --output-logs=errors-only
```
Expected: exit 0 (this includes storybook and treeshake; several minutes).

- [ ] **Step 5: Commit**

```bash
git add turbo.json scripts/turbo.sh scripts/__tests__
git commit -m "turbo: rt's static gates are root tasks beside the apps' gates"
```

### Task 5: CI: scope, turbo in static, deck on macOS, purity, renovate

**Files:**
- Modify: `scripts/ci/test-scope.ts`, `scripts/ci/__tests__/test-scope.test.ts`, `.github/workflows/checks.yml`, `scripts/repo-purity.sh`, `.github/renovate-global.json5`
- Delete: `docs/apps/root-github/`, `docs/apps/root-repo-purity.sh`

- [ ] **Step 1: Write the failing test-scope tests**

Add to `scripts/ci/__tests__/test-scope.test.ts`, using the file's existing helper for building a `ScopeInput` (a PR event with `sources` = the real unit sources):

```ts
test("an apps-only PR skips the unit shards", () => {
  const d = decide(prInput(["apps/board/src/App.tsx", "packages/ui/src/index.ts", "docs/apps/README.md"]));
  expect(d.mode).toBe("skip");
});

test("apps root config read by a unit test still runs", () => {
  // scripts/__tests__/turbo-inputs.test.ts reads turbo.json
  const d = decide(prInput(["turbo.json"]));
  expect(d.mode).not.toBe("skip");
});

test("an apps fixture does not force the full suite", () => {
  const d = decide(prInput(["apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json"]));
  expect(d.mode).toBe("skip");
});
```
Run: `bun test scripts/ci/__tests__/test-scope.test.ts`. Expected: the first and third fail (`full`), the second passes.

- [ ] **Step 2: Teach `decide` the apps trees**

In `scripts/ci/test-scope.ts` add after `isFixture`:

```ts
const APPS_PACKAGES = ["gate-kit", "server", "tokens", "tokyo", "tui-kit", "ui"];
const APPS_ROOT_FILES = new Set([
  "turbo.json", "eslint.config.mjs", ".prettierrc", ".prettierignore",
  "tsconfig.tools.json", "vitest.config.ts", "scripts/turbo.sh", "scripts/set-platform-version.ts",
]);

/** The apps' trees run under turbo in `static`; the unit shards never read them. */
function isAppsTree(f: string): boolean {
  return (
    f.startsWith("apps/") ||
    APPS_PACKAGES.some((p) => f.startsWith(`packages/${p}/`)) ||
    f.startsWith("docs/apps/") ||
    f.startsWith("stories/") ||
    f.startsWith(".storybook/") ||
    f.startsWith("probe/") ||
    APPS_ROOT_FILES.has(f)
  );
}
```
and change the skippable predicate to:
```ts
const skippable = input.changed.every((f) => isAppsTree(f) || ((isDocs(f) || isSwift(f)) && !isFixture(f)));
```
Update the skip reason string to `"only docs, swift or apps trees, none of it read by a unit test"` and any test asserting the old wording. The existing `readBy` check runs after, unchanged, which is what keeps `turbo.json` from skipping.

Run the test file. Expected: all pass. Also `bun scripts/ci/test-scope.ts --explain` on a branch with only an apps change should print `skip`.

- [ ] **Step 3: Rewrite `static` in `checks.yml` and add `deck-macos`**

In `.github/workflows/checks.yml`:

1. Under `static`'s `actions/checkout@v4` add `with: fetch-depth: 0` (turbo `--affected` diffs against the base sha).
2. Delete the three steps `Typecheck`, `Command reference is in sync`, `Picker convention is enforced` (turbo runs them as root tasks).
3. In the `Workflow lint` step remove `.github/workflows/bundle-apps.yml` from the actionlint list.
4. After the `Settings schema changes are classified` step add:

```yaml
      # A PR restores main's newest cache; main restores its own previous one.
      # Entries older than a week are dropped first or compiled binaries pile up.
      - uses: actions/cache@v4
        with:
          path: .git/turbo-cache
          key: turbo-${{ runner.os }}-${{ github.sha }}
          restore-keys: turbo-${{ runner.os }}-
      - run: find .git/turbo-cache -type f -mtime +7 -delete 2>/dev/null || true
      - name: Apps and packages, plus rt's static gates (turbo)
        if: github.event_name == 'pull_request'
        env:
          TURBO_TELEMETRY_DISABLED: "1"
          TURBO_SCM_BASE: ${{ github.event.pull_request.base.sha }}
        run: scripts/turbo.sh check --affected --concurrency=4 --output-logs=errors-only
      - name: Apps and packages, plus rt's static gates (turbo, main)
        if: github.event_name != 'pull_request'
        env:
          TURBO_TELEMETRY_DISABLED: "1"
        run: scripts/turbo.sh check --concurrency=4 --output-logs=errors-only
```
5. Add a job after `go`:

```yaml
  # deck supervises launchd and shells to plutil, both macOS-only, so its suite
  # runs here and nowhere else (scripts/turbo.sh drops it off macOS).
  deck-macos:
    runs-on: macos-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - uses: actions/cache@v4
        with:
          path: .git/turbo-cache
          key: turbo-${{ runner.os }}-${{ github.sha }}
          restore-keys: turbo-${{ runner.os }}-
      - run: find .git/turbo-cache -type f -mtime +7 -delete 2>/dev/null || true
      - if: github.event_name == 'pull_request'
        env:
          TURBO_TELEMETRY_DISABLED: "1"
          TURBO_SCM_BASE: ${{ github.event.pull_request.base.sha }}
        run: scripts/turbo.sh test --filter=deck --affected --output-logs=errors-only
      - if: github.event_name != 'pull_request'
        env:
          TURBO_TELEMETRY_DISABLED: "1"
        run: scripts/turbo.sh test --filter=deck --output-logs=errors-only
```
6. `checks` job: `needs: [scope, static, go, deck-macos, unit]`, add `DECK: ${{ needs.deck-macos.result }}` and the line `[ "$DECK" = success ] || { echo "deck-macos did not succeed"; exit 1; }` after the go check.
7. `timeout-minutes` on `static` becomes `30` (storybook and treeshake run there on a cold cache).

Lint locally:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/v1.7.12/scripts/download-actionlint.bash) 1.7.12 /tmp && /tmp/actionlint .github/workflows/checks.yml
```
Expected: no findings. Then `git rm -r docs/apps/root-github`.

- [ ] **Step 4: One purity gate**

`scripts/repo-purity.sh`: replace the `PATTERN=` line and the `A10` definition with apps' boundary form, keep rt's `A11`:
```sh
A10=$(printf "%s%s" "progres" "sive")
A10B="(^|[^[:alnum:]])$A10([^[:alnum:]]|\$)"
A11=$(printf '%s%s' 'gei' 'co')
PATTERN="$A1|$A2|$A3|$A4|$A5|$A6|$A7|$A8|$A9|$A10B|$A11"
```
and change the tracked-tree grep to exclude PNGs the way apps did:
```sh
HITS=$(cd "$ROOT" \
  && git ls-files -z \
    -- ':(exclude)*bun.lock' \
       ':(exclude)*package-lock.json' \
       ':(exclude)*.png' \
  | xargs -0 grep -IniE "$PATTERN" 2>/dev/null \
  | grep -v '^scripts/repo-purity.sh:' || true)
```
Run `scripts/repo-purity.sh`. Expected: `ok   repo-purity`. A hit inside `apps/**` or `packages/**` is real: scrub it in place with a neutral placeholder (the imported tree passed its own gate, so hits come only from rt's extra term). Then `git rm docs/apps/root-repo-purity.sh`.

- [ ] **Step 5: Renovate stops visiting the apps repo**

In `.github/renovate-global.json5` delete the line `"m4ttstack/apps",` and in the header comment change `deck, board, console, chat, tui-kit and app-kit all live in m4ttstack/apps now` to `deck, board, console, chat, tui-kit and app-kit all live in this repo now`.

- [ ] **Step 6: Commit**

```bash
git add scripts/ci .github/workflows/checks.yml scripts/repo-purity.sh .github/renovate-global.json5 docs/apps
git commit -m "ci: apps trees skip the shards; turbo check in static; deck on macOS; one purity list"
```

### Task 6: deps.lock tree rows

**Files:**
- Modify: `lib/bundle-layout.ts`, `scripts/lib/deps-lock.ts`, `scripts/fetch-deps.sh`, `rt-tray/deps.lock`, `scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json`, `apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json`, `scripts/lib/__tests__/deps-lock-serve-parity.test.ts`, `apps/deck/src/registry/bundle-catalog.test.ts` (the digest constant)
- Test: `lib/__tests__/bundle-layout.test.ts`, `scripts/__tests__/deps-lock.test.ts`, `scripts/__tests__/fetch-deps-tree.test.ts` (new)

**Interfaces:**
- Produces: `DepsLockTool.source?: "tree"`, `DepsLockTool.skills?: boolean`; TSV column 12 = `source` (`""` for fetched rows); `bun scripts/lib/deps-lock.ts --source tree`.

- [ ] **Step 1: Write the failing bundle-layout tests**

Add to `lib/__tests__/bundle-layout.test.ts` (use the file's existing minimal-row helper; if none, build one from the `jq` row in `rt-tray/deps.lock`):

```ts
describe("tree rows", () => {
  const tree = { name: "board", version: "", license: "MIT", source: "tree", archive: "raw", extract: "",
    bundlePath: "Contents/Helpers/board", exec: ["Contents/Helpers/board"], exposeByDefault: false,
    entitlements: "jit", status: "bundled", kind: "helper", skills: true, serve: { port: 11006, args: [] } };
  const lock = (t: unknown) => JSON.stringify({ schema: 1, arch: "arm64", tools: [t] });

  test("a tree row needs no url or sha256", () => {
    expect(parseDepsLock(lock(tree)).tools[0]!.source).toBe("tree");
  });
  test("a tree row with a url is rejected", () => {
    expect(() => parseDepsLock(lock({ ...tree, url: "https://x" }))).toThrow(/tree row must not carry url/);
  });
  test("a tree row with repo or subdir is rejected", () => {
    expect(() => parseDepsLock(lock({ ...tree, repo: "m4ttstack/rt" }))).toThrow(/tree row must not carry repo/);
  });
  test("a fetched row still needs url and sha256", () => {
    const { source: _s, ...fetched } = tree;
    expect(() => parseDepsLock(lock(fetched))).toThrow(/url must be a string/);
  });
  test("skills must be a boolean when present", () => {
    expect(() => parseDepsLock(lock({ ...tree, skills: "yes" }))).toThrow(/skills must be boolean/);
  });
});
```
Run: `bun test lib/__tests__/bundle-layout.test.ts`. Expected: the tree tests fail.

- [ ] **Step 2: Implement the schema change**

In `lib/bundle-layout.ts`:

```ts
export type DepsLockSource = "tree";
```
Add to `DepsLockTool` (with the other optional fields):
```ts
  /** "tree": built from this checkout by scripts/build-apps.ts, never downloaded; url and sha256 are absent. */
  source?: DepsLockSource;
  /** The app's skills/ directory ships at Contents/Helpers/skills/<name>. Tree rows only. */
  skills?: boolean;
```
Change the constants and the loop:
```ts
const REQUIRED_STRING_FIELDS = ["name", "version", "license", "extract", "bundlePath"] as const;
const FETCHED_STRING_FIELDS = ["url", "sha256"] as const;
```
Inside `raw.tools.forEach`, after the `REQUIRED_STRING_FIELDS` loop:
```ts
    const row = t as unknown as Record<string, unknown>;
    if (row.source === undefined) {
      for (const field of FETCHED_STRING_FIELDS) {
        if (typeof row[field] !== "string") throw new Error(`deps.lock: tools[${i}].${field} must be a string`);
      }
    } else if (row.source === "tree") {
      for (const field of FETCHED_STRING_FIELDS) {
        if (row[field] !== undefined) throw new Error(`deps.lock: tools[${i}] tree row must not carry ${field}`);
      }
      for (const field of ["repo", "subdir"] as const) {
        if (row[field] !== undefined) throw new Error(`deps.lock: tools[${i}] tree row must not carry ${field}`);
      }
      if (row.kind !== "helper") throw new Error(`deps.lock: tools[${i}] tree row must be a helper`);
    } else {
      throw new Error(`deps.lock: tools[${i}] has unknown source ${String(row.source)}`);
    }
    if (row.skills !== undefined) {
      if (typeof row.skills !== "boolean") throw new Error(`deps.lock: tools[${i}].skills must be boolean`);
      if (row.source !== "tree") throw new Error(`deps.lock: tools[${i}].skills is only valid on a tree row`);
    }
```
Move this block before the `name` read so the error ids match the tests' `tools[i]` form. Any later code that reads `t.url`/`t.sha256` unconditionally (search the file) must treat them as `string | undefined`.

In `scripts/lib/deps-lock.ts`: `toTsvRow` emits `tsvField(t.url ?? "", ...)`, `tsvField(t.sha256 ?? "", ...)`, and appends a 12th field `t.source ?? ""`. Add a `--source` option next to `--kind`: `if (source && t.source !== source) continue;`. Update `scripts/__tests__/deps-lock.test.ts` for 12 columns and the new filter.

Run both test files. Expected: pass.

- [ ] **Step 3: fetch-deps skips tree rows**

In `scripts/fetch-deps.sh` change the field-count check to `-ne 12` (message `expected 12`) and, right after `status="${FIELDS[8]}"; kind="${FIELDS[9]}"`, add:
```bash
  source="${FIELDS[11]}"
  if [ "$source" = tree ]; then
    echo "  . $name: built from this checkout by scripts/build-apps.ts, not fetched"
    continue
  fi
```
Write `scripts/__tests__/fetch-deps-tree.test.ts` following `fetch-deps-skills.test.ts`'s pattern (a temp lock via `RT_DEPS_LOCK`, temp `RT_DEPS_ROOT`, `RT_DEPS_CACHE`): a lock with one tree row and one `raw` tool row whose `url` is a `file://` path to a temp file with a matching sha256. Assert the tool lands at `<deps>/arm64/<tool>` and no path for the tree row exists, and that stdout contains `built from this checkout`. Run it. Expected: pass.

`rt-tray/build.sh` and `rt-tray/check-bundle.sh` index columns by position and ignore trailing fields; no change.

- [ ] **Step 4: Rewrite the five app rows in `rt-tray/deps.lock`**

Replace the deck, board, console, chat and boxscore rows with (ports and flags exactly as today):

```json
    { "name": "deck", "version": "", "license": "MIT", "source": "tree", "skills": true,
      "archive": "raw", "extract": "", "bundlePath": "Contents/Helpers/deck", "exec": ["Contents/Helpers/deck"],
      "exposeByDefault": true, "entitlements": "jit", "status": "bundled", "kind": "helper" },
    { "name": "board", "version": "", "license": "MIT", "source": "tree", "skills": true,
      "archive": "raw", "extract": "", "bundlePath": "Contents/Helpers/board", "exec": ["Contents/Helpers/board"],
      "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
      "serve": { "port": 11006, "args": [] } },
    { "name": "console", "version": "", "license": "MIT", "source": "tree",
      "archive": "raw", "extract": "", "bundlePath": "Contents/Helpers/console", "exec": ["Contents/Helpers/console"],
      "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
      "serve": { "port": 11001, "args": [] } },
    { "name": "chat", "version": "", "license": "MIT", "source": "tree",
      "archive": "raw", "extract": "", "bundlePath": "Contents/Helpers/chat", "exec": ["Contents/Helpers/chat"],
      "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
      "serve": { "port": 11002, "args": [] } },
    { "name": "boxscore", "version": "", "license": "MIT", "source": "tree",
      "archive": "raw", "extract": "", "bundlePath": "Contents/Helpers/boxscore", "exec": ["Contents/Helpers/boxscore"],
      "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
      "serve": { "port": 11005, "args": [] } },
```
The gitq row stays fetched until Stage C. `bun scripts/lib/deps-lock.ts --source tree | wc -l` prints 5.

- [ ] **Step 5: Move the parity fixture in both places**

Edit `scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json`: change the `board` row to a tree row (drop `url`, `sha256`, `repo`, `subdir`; add `"source": "tree", "skills": true`; `version` `""`). Copy the file byte for byte over `apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json`. Compute the new digest:
```bash
shasum -a 256 scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json
cmp scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json && echo twins
```
Put the digest into `FIXTURE_SHA256` in `scripts/lib/__tests__/deps-lock-serve-parity.test.ts` and into the matching constant in `apps/deck/src/registry/bundle-catalog.test.ts`. Change the parity test's comment to name the twin's new path (`apps/deck/src/registry/__fixtures__/...`, same repo). Run:
```bash
bun test scripts/lib/__tests__/deps-lock-serve-parity.test.ts scripts/lib/__tests__/vm-served-catalog.test.ts
scripts/turbo.sh test --filter=deck --output-logs=errors-only
```
Expected: pass on both sides.

- [ ] **Step 6: Commit**

```bash
git add lib/bundle-layout.ts lib/__tests__ scripts/lib scripts/fetch-deps.sh scripts/__tests__ rt-tray/deps.lock apps/deck/src/registry
git commit -m "deps.lock: tree rows are built from this checkout, never fetched"
```

### Task 7: `scripts/build-apps.ts` builds the tree rows into `rt-tray/deps/arm64`

**Files:**
- Create: `scripts/build-apps.ts`, `scripts/__tests__/build-apps.test.ts`
- Modify: `apps/board/mattstack.deck.json`, `apps/deck/mattstack.deck.json`, `apps/chat/mattstack.deck.json`, `apps/console/mattstack.deck.json`, `apps/boxscore/mattstack.deck.json` (drop the `bun install --frozen-lockfile && ` prefix from `bundle.build`; the workspace installs once at the root)
- Delete: `scripts/bundle-ci/plan-matrix.ts`, `scripts/bundle-ci/update-lock.ts`, `scripts/bundle-ci/__tests__/plan-matrix.test.ts`, `scripts/bundle-ci/__tests__/update-lock.test.ts`

**Interfaces:**
- Consumes: `parseDepsLock` (Task 6), `readBundleRecipe` from `scripts/bundle-ci/validate-manifest.ts`, `stageIdentity` from `scripts/lib/app-identity.ts`.
- Produces: `bun scripts/build-apps.ts [--arch arm64]`, env `RT_DEPS_ROOT`, `RT_DEPS_LOCK`, `RT_APPS_ROOT`; exports `buildTreeRows(seams): Promise<string[]>` (names built) for the test.

- [ ] **Step 1: Write the failing test**

`scripts/__tests__/build-apps.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTreeRows } from "../build-apps.ts";

function fakeApp(root: string, name: string, opts: { skills?: boolean; serve?: boolean } = {}) {
  const dir = join(root, name);
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({
    name, displayName: name, icon: "icon.svg",
    ...(opts.serve ? { port: 11090, includeInBundle: true } : {}),
    bundle: { build: `printf '#!/bin/sh\\necho ${name} 0.0.0\\n' > dist/${name} && chmod 755 dist/${name}`, artifact: `dist/${name}` },
  }));
  writeFileSync(join(dir, "icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  if (opts.skills) {
    mkdirSync(join(dir, "skills", "hello"), { recursive: true });
    writeFileSync(join(dir, "skills", "hello", "SKILL.md"), "# hello\n");
  }
  return dir;
}

describe("build-apps", () => {
  test("lands every tree row like fetch-deps would", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    fakeApp(apps, "alpha", { skills: true, serve: true });
    fakeApp(apps, "beta");
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [
      { name: "alpha", version: "", license: "MIT", source: "tree", skills: true, archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/alpha", exec: ["Contents/Helpers/alpha"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper", serve: { port: 11090, args: [] } },
      { name: "beta", version: "", license: "MIT", source: "tree", archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/beta", exec: ["Contents/Helpers/beta"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper" },
      { name: "jq", version: "1", license: "MIT", url: "https://example.invalid/jq", sha256: "0".repeat(64),
        archive: "raw", extract: "", bundlePath: "Contents/Helpers/jq", exec: ["Contents/Helpers/jq"],
        exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper" },
    ] }));
    const deps = join(work, "deps");
    const built = await buildTreeRows({ appsRoot: apps, depsRoot: deps, lockPath: lock, arch: "arm64", log: () => {} });
    expect(built).toEqual(["alpha", "beta"]);
    expect(readFileSync(join(deps, "arm64", "alpha"), "utf8")).toContain("alpha 0.0.0");
    expect(existsSync(join(deps, "arm64", "alpha-identity", "mattstack.deck.json"))).toBe(true);
    expect(existsSync(join(deps, "arm64", "alpha-skills", "hello", "SKILL.md"))).toBe(true);
    expect(existsSync(join(deps, "arm64", "beta-skills"))).toBe(false);
    expect(existsSync(join(deps, "arm64", "jq"))).toBe(false);
  });

  test("refuses an artifact the recipe did not produce", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    const dir = fakeApp(apps, "gamma");
    writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "gamma", bundle: { build: "true", artifact: "dist/gamma" } }));
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [
      { name: "gamma", version: "", license: "MIT", source: "tree", archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/gamma", exec: ["Contents/Helpers/gamma"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper" } ] }));
    await expect(buildTreeRows({ appsRoot: apps, depsRoot: join(work, "deps"), lockPath: lock, arch: "arm64", log: () => {} }))
      .rejects.toThrow(/gamma: dist\/gamma missing or not executable/);
  });
});
```
Run: `bun test scripts/__tests__/build-apps.test.ts`. Expected: fails to import `../build-apps.ts`.

- [ ] **Step 2: Write `scripts/build-apps.ts`**

```ts
#!/usr/bin/env bun
/**
 * Builds every deps.lock row with source "tree" from this checkout into
 * rt-tray/deps/<arch>/, in the layout scripts/fetch-deps.sh produces for a
 * downloaded row: the artifact at <name>, the launcher identity at
 * <name>-identity, the agent skills at <name>-skills. build.sh then bundles
 * both kinds of row the same way.
 *
 *   bun scripts/build-apps.ts [--arch arm64]
 * Env: RT_DEPS_ROOT (default rt-tray/deps), RT_DEPS_LOCK (default
 * rt-tray/deps.lock), RT_APPS_ROOT (default apps/).
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { parseDepsLock } from "../lib/bundle-layout.ts";
import { stageIdentity } from "./lib/app-identity.ts";
import { readBundleRecipe } from "./bundle-ci/validate-manifest.ts";

const ROOT = resolve(import.meta.dir, "..");

export interface BuildAppsSeams {
  appsRoot: string;
  depsRoot: string;
  lockPath: string;
  arch: "arm64";
  log(line: string): void;
}

const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

export async function buildTreeRows(s: BuildAppsSeams): Promise<string[]> {
  const lock = parseDepsLock(readFileSync(s.lockPath, "utf8"));
  if (lock.arch !== s.arch) throw new Error(`deps.lock arch is ${lock.arch}, this run wants ${s.arch}`);
  const deps = join(s.depsRoot, s.arch);
  mkdirSync(deps, { recursive: true });
  const built: string[] = [];
  for (const row of lock.tools) {
    if (row.source !== "tree") continue;
    if (row.status !== "bundled") { s.log(`  . ${row.name}: pending, not built`); continue; }
    if (!SAFE_NAME.test(row.name)) throw new Error(`refusing unsafe tool name: ${row.name}`);
    const app = join(s.appsRoot, row.name);
    const recipe = readBundleRecipe(join(app, "mattstack.deck.json"));
    s.log(`  -> ${row.name}: ${recipe.build}`);
    const run = spawnSync("bash", ["-c", recipe.build], { cwd: app, stdio: "inherit", env: process.env });
    if (run.status !== 0) throw new Error(`${row.name}: bundle.build exited ${run.status}`);
    const artifact = join(app, recipe.artifact);
    if (!existsSync(artifact) || !(statSync(artifact).mode & 0o111)) {
      throw new Error(`${row.name}: ${recipe.artifact} missing or not executable`);
    }
    const smoke = spawnSync(artifact, ["--version"], { stdio: "ignore" });
    if (smoke.status !== 0) throw new Error(`${row.name}: ${recipe.artifact} --version exited ${smoke.status}`);
    for (const suffix of ["", "-identity", "-skills", ".sha256", "-identity.sha256", "-skills.sha256"]) {
      rmSync(join(deps, `${row.name}${suffix}`), { recursive: true, force: true });
    }
    copyFileSync(artifact, join(deps, row.name));
    chmodSync(join(deps, row.name), 0o755);
    stageIdentity(app, join(deps, `${row.name}-identity`), row.name);
    if (row.skills) {
      const skills = join(app, "skills");
      if (!existsSync(skills)) throw new Error(`${row.name}: deps.lock says skills but apps/${row.name}/skills is absent`);
      cpSync(skills, join(deps, `${row.name}-skills`), { recursive: true });
    }
    s.log(`  ok ${row.name}`);
    built.push(row.name);
  }
  return built;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const archAt = args.indexOf("--arch");
  const arch = archAt >= 0 ? args[archAt + 1] : "arm64";
  if (arch !== "arm64") { console.error("usage: bun scripts/build-apps.ts [--arch arm64]"); process.exit(2); }
  if (process.arch !== "arm64") { console.error(`build host is ${process.arch}; deps/arm64 must be built on arm64`); process.exit(1); }
  const built = await buildTreeRows({
    appsRoot: process.env.RT_APPS_ROOT ?? join(ROOT, "apps"),
    depsRoot: process.env.RT_DEPS_ROOT ?? join(ROOT, "rt-tray", "deps"),
    lockPath: process.env.RT_DEPS_LOCK ?? join(ROOT, "rt-tray", "deps.lock"),
    arch,
    log: (line) => console.log(line),
  });
  console.log(`Built ${built.length} tree row(s): ${built.join(", ")}`);
}
```
Check `stageIdentity`'s real signature in `scripts/lib/app-identity.ts:153` (`stageIdentity(appDir, outDir, expectedName?)`) and `readBundleRecipe`'s (`validate-manifest.ts`); adapt the two calls if they differ. If `stageIdentity` writes nothing for an app with no identity, the `-identity` dir simply does not exist, which is what fetch-deps produces for such a tarball.

Run the test. Expected: pass.

- [ ] **Step 3: Strip the install prefix from the five recipes**

In each `apps/<name>/mattstack.deck.json` `bundle.build`, remove the leading `bun install --frozen-lockfile && `. Then build for real:
```bash
bun scripts/build-apps.ts
ls rt-tray/deps/arm64 | grep -E '^(deck|board|console|chat|boxscore)'
```
Expected: five binaries, `board-identity`, `console-identity`, `chat-identity`, `boxscore-identity`, `board-skills`, `deck-skills`.

- [ ] **Step 4: Prove the bundle still assembles**

```bash
scripts/fetch-deps.sh arm64
RT_DAEMON_BIN="$PWD/dist/rt" RT_VERSION=0.0.0 rt-tray/build.sh dev
rt-tray/check-bundle.sh --app rt-tray/mattstack-dev.app 2>&1 | tail -5
```
(`bun build --compile --target=bun-darwin-arm64 --no-compile-autoload-bunfig --no-compile-autoload-dotenv ./cli.ts --outfile dist/rt` first if `dist/rt` is absent; never run that binary outside `env -i HOME=<temp>`.) Expected: check-bundle ends with zero failures. The dev bundle is a scratch product under `rt-tray/`, gitignored; do not install it.

- [ ] **Step 5: Delete the bot-PR half of bundle-ci**

```bash
git rm scripts/bundle-ci/plan-matrix.ts scripts/bundle-ci/update-lock.ts scripts/bundle-ci/__tests__/plan-matrix.test.ts scripts/bundle-ci/__tests__/update-lock.test.ts
bun run test 2>&1 | tail -3
```
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-apps.ts scripts/__tests__/build-apps.test.ts apps/*/mattstack.deck.json scripts/bundle-ci
git commit -m "build-apps: build deps.lock tree rows from this checkout into rt-tray/deps"
```

### Task 8: release.yml builds the apps in a job without the signing key

**Files:**
- Modify: `.github/workflows/release.yml`
- Delete: `.github/workflows/bundle-apps.yml`, `apps/deck/src/cli/update.ts`, `apps/deck/src/cli/update.test.ts`, `apps/deck/scripts/install.sh`, plus the `update` verb's registration in `apps/deck/src/cli/commands.ts`

- [ ] **Step 1: Add the `build-apps` job**

At the top of `jobs:` in `release.yml`, before `release:`:

```yaml
  # App code runs here and only here. The release job below imports the
  # Developer ID key and never runs a recipe; it receives these bytes as an
  # artifact and signs them like any fetched helper.
  build-apps:
    runs-on: macos-15
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - name: Build the tree rows
        run: bun scripts/build-apps.ts --arch arm64
      # upload-artifact strips executable bits and dereferences symlinks;
      # tar keeps the binaries runnable.
      - name: Pack the handoff
        run: tar czf apps-handoff.tgz -C rt-tray/deps/arm64 .
      - uses: actions/upload-artifact@v4
        with:
          name: apps-handoff
          path: apps-handoff.tgz
```
Add `needs: build-apps` to the `release` job. After its `Fetch bundled dependencies` step add:

```yaml
      - name: Land the tree rows
        uses: actions/download-artifact@v4
        with:
          name: apps-handoff
          path: handoff
      - run: |
          mkdir -p rt-tray/deps/arm64
          tar xzf handoff/apps-handoff.tgz -C rt-tray/deps/arm64
          ls rt-tray/deps/arm64
```
Remove the stale comment on `Fetch bundled dependencies` about console and chat being private repos (every org repo is public); keep the `GH_TOKEN` env since gitq's release asset is still fetched until Stage C.

- [ ] **Step 2: Delete bundle-apps and deck's standalone updater**

```bash
git rm .github/workflows/bundle-apps.yml apps/deck/src/cli/update.ts apps/deck/src/cli/update.test.ts apps/deck/scripts/install.sh
grep -rn "update" apps/deck/src/cli/commands.ts | head
```
Remove the `update` command registration and its import from `commands.ts` (and its usage line in deck's `--help` text, `README.md` and `docs/` if they mention `deck update` or `install.sh`; grep `apps/deck` for both strings). Then:
```bash
scripts/turbo.sh test typecheck --filter=deck --output-logs=errors-only
```
Expected: pass.

- [ ] **Step 3: Lint the workflow and rehearse**

```bash
/tmp/actionlint .github/workflows/release.yml
```
Expected: only the pre-existing shellcheck findings the checks workflow comment already grandfathers. Compare against `git show main:.github/workflows/release.yml > /tmp/release-main.yml && /tmp/actionlint /tmp/release-main.yml`: the new file adds no finding.

Push the branch and dispatch a rehearsal: `gh workflow run release.yml --ref <branch>`; watch `gh run list --workflow release.yml --branch <branch>`. Expected: `build-apps` green, `release` green through `Assert the bundle contract` (a dry run is ad-hoc signed and skips publish). This rehearsal is the gate for the task; a red run is a finding to fix here.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml apps/deck
git commit -m "release: build the bundled apps in-tree in a job that holds no signing key"
```

### Task 9: Preflight: path gate; drop the pin rows

**Files:**
- Modify: `lib/release/preflight.ts`, `lib/release/__tests__/preflight.test.ts`, `commands/release.ts` (the printed row order, if it names row ids)

**Interfaces:**
- Produces: `checkGate(seams, tag, ref="HEAD"): Promise<GateImplication>` by path; `movedServedApps(files: string[]): string[]`; `SERVE_ONLY_APPS`; `classifyRows` returns `{ standalone, tools }` (tree rows dropped); `checkAppPins` and `checkRtClient` removed; `DepsRow.source?: string`.

- [ ] **Step 1: Write the failing gate tests**

Replace the existing `checkGate` tests in `lib/release/__tests__/preflight.test.ts` with tests built on a fake `exec` that answers `git diff --name-only <tag>..<ref>` with a canned list (the file already has a seams factory; extend it):

```ts
describe("checkGate by path", () => {
  const gate = (files: string[]) => checkGate(seamsWithDiff(files), "v2.13.0");
  test("a served app plus notes and website is fast", async () => {
    expect((await gate(["apps/board/src/a.ts", "RELEASE_NOTES.md", "website/docs/x.md"])).path).toBe("fast");
  });
  test("deck alone is full", async () => {
    expect((await gate(["apps/deck/src/main.ts"])).path).toBe("full");
  });
  test("a served app plus rt code is full", async () => {
    const g = await gate(["apps/board/src/a.ts", "lib/daemon.ts"]);
    expect(g.path).toBe("full");
    expect(g.reason).toContain("lib/daemon.ts");
  });
  test("notes alone is full: no served app moved", async () => {
    expect((await gate(["RELEASE_NOTES.md"])).path).toBe("full");
  });
  test("no diff is full", async () => {
    expect((await gate([])).path).toBe("full");
  });
});

test("movedServedApps names each served app directory in the diff once", () => {
  expect(movedServedApps(["apps/chat/a.ts", "apps/chat/b.ts", "apps/gitq/x.ts", "apps/deck/y.ts", "lib/z.ts"])).toEqual(["chat", "gitq"]);
});
```
Delete the `checkAppPins`, `checkRtClient`, `pinOnly`-style and `keepsFastPath`-by-row tests. Run the file. Expected: the new tests fail.

- [ ] **Step 2: Implement**

In `lib/release/preflight.ts`:

```ts
/** Apps deck merely serves; a diff limited to their directories, the notes and website keeps the fast path. */
export const SERVE_ONLY_APPS = ["board", "boxscore", "chat", "console", "gitq"] as const;
const FAST_PATH_FILES = new Set(["RELEASE_NOTES.md"]);

export function fastPathApp(file: string): string | null {
  for (const app of SERVE_ONLY_APPS) if (file.startsWith(`apps/${app}/`)) return app;
  return null;
}

export function movedServedApps(files: string[]): string[] {
  const seen = new Set<string>();
  for (const f of files) { const app = fastPathApp(f); if (app) seen.add(app); }
  return SERVE_ONLY_APPS.filter((a) => seen.has(a));
}

export function keepsFastPath(name: string): boolean {
  return (SERVE_ONLY_APPS as readonly string[]).includes(name);
}

export async function checkGate(seams: Pick<PreflightSeams, "repoRoot" | "exec">, tag: string, ref = "HEAD"): Promise<GateImplication> {
  try {
    const files = (await git(seams, ["diff", "--name-only", `${tag}..${ref}`])).split("\n").map((f) => f.trim()).filter(Boolean);
    if (files.length === 0) return { path: "full", reason: "no changes since the tag" };
    const outside = files.filter((f) => !FAST_PATH_FILES.has(f) && !f.startsWith("website/") && !fastPathApp(f));
    if (outside.length > 0) return { path: "full", reason: `changes outside the served apps, notes and website: ${outside.slice(0, 5).join(", ")}` };
    const moved = movedServedApps(files);
    if (moved.length === 0) return { path: "full", reason: "no served app moved since the tag" };
    return { path: "fast", reason: `served app(s) moved: ${moved.join(", ")}` };
  } catch (err) {
    return { path: "full", reason: `could not classify the diff (${String((err as Error).message ?? err)}); assume full` };
  }
}
```
Remove `SERVE_ONLY_ROWS`, `FAST_PATH_FILES`' old contents, `checkAppPins`, `checkRtClient`, `readDepsRows`' use in the gate, and `serveKey` if nothing else uses it. `DepsRow` gains `source?: string`. `classifyRows` becomes:
```ts
export function classifyRows(rows: DepsRow[]): { standalone: DepsRow[]; tools: DepsRow[] } {
  const standalone: DepsRow[] = [];
  const tools: DepsRow[] = [];
  for (const r of rows) {
    if (r.source === "tree") continue;
    if (r.name in STANDALONE_REPOS) standalone.push(r);
    else tools.push(r);
  }
  return { standalone, tools };
}
```
In `runPreflight` drop `apps`, `appRows`, `rtClientRow` from the destructuring, the `Promise.all` and the `rows` array. Update the header comment: "per-layer pin freshness across every vendored surface" stays true for tools, fast-browser, catalog and extension; delete "rt-client npm-vs-source parity".

Run the test file and `bun run typecheck`. Expected: pass. `grep -rn "checkAppPins\|checkRtClient\|SERVE_ONLY_ROWS" lib commands` prints nothing.

- [ ] **Step 3: Commit**

```bash
git add lib/release/preflight.ts lib/release/__tests__/preflight.test.ts commands/release.ts
git commit -m "release preflight: classify the gate by path; apps and rt-client have no pins"
```

### Task 10: `rt release app` without a bump, a bundle or a bot PR

**Files:**
- Modify: `lib/release/release-app.ts`, `lib/release/__tests__/release-app.test.ts`, `lib/release/__tests__/release-app-run.test.ts`, `commands/release.ts`
- Test: the two test files above

**Interfaces:**
- Consumes: `checkGate`, `movedServedApps`, `keepsFastPath` (Task 9); `runVerify` (unchanged).
- Produces: `StepId = "qualify" | "notes" | "tag" | "verify"`; `ReleaseAppSeams` without the gh workflow, PR and apps-repo seams; `renderNotes({ sections, lastTag, nextTag })` without `held`; `notesSectionsFor(seams, lastTag, apps): Promise<NotesSection[]>`.

- [ ] **Step 1: Write the failing run tests**

In `lib/release/__tests__/release-app-run.test.ts`, replace the bump/bundle/PR scenarios with these, using the file's fake-seams builder (git answers: `fetch`, `rev-parse origin/main`, `status --porcelain`, `ls-remote --tags`, `diff --name-only`, `log --format=%s <tag>..HEAD -- apps/<app>/`, `tag -a`, `push`):

```ts
test("refuses an app that has not moved since the last tag", async () => {
  const seams = fakeSeams({ diff: ["apps/chat/x.ts", "RELEASE_NOTES.md"] });
  const report = await runReleaseApp(seams, { name: "board", dryRun: true });
  expect(report.status).toBe("declined");
  expect(report.steps[0]).toMatchObject({ id: "qualify", status: "stopped" });
  expect(report.steps[0]!.detail).toContain("board has not moved since v2.13.0");
});

test("refuses deck: it is not a served-only app", async () => {
  const seams = fakeSeams({ diff: ["apps/deck/x.ts"] });
  const report = await runReleaseApp(seams, { name: "deck", dryRun: true });
  expect(report.status).toBe("declined");
});

test("refuses a diff that leaves the fast path", async () => {
  const seams = fakeSeams({ diff: ["apps/board/x.ts", "lib/daemon.ts"] });
  const report = await runReleaseApp(seams, { name: "board", dryRun: true });
  expect(report.status).toBe("declined");
  expect(report.steps[0]!.detail).toContain("lib/daemon.ts");
});

test("dry run plans notes, tag and verify for every moved app", async () => {
  const seams = fakeSeams({ diff: ["apps/board/x.ts", "apps/chat/y.ts"], subjects: { board: ["board: fix a"], chat: ["chat: fix b"] } });
  const report = await runReleaseApp(seams, { name: "board", dryRun: true });
  expect(report.status).toBe("planned");
  expect(report.steps.map((s) => s.id)).toEqual(["qualify", "notes", "tag", "verify"]);
  expect(report.notes).toContain("### board");
  expect(report.notes).toContain("### chat");
  expect(report.nextTag).toBe("v2.13.1");
});

test("stops at the notes for approval, then tags the exercised sha on resume", async () => {
  const seams = fakeSeams({ diff: ["apps/board/x.ts"], subjects: { board: ["board: fix a"] } });
  const first = await runReleaseApp(seams, { name: "board" });
  expect(first.status).toBe("awaiting-approval");
  const second = await runReleaseApp(seams, { name: "board", yesNotes: first.notesHash! });
  expect(seams.calls).toContainEqual(["git", "tag", "-a", "v2.13.1", seams.notesCommitSha, "-m", "v2.13.1"]);
  expect(second.steps.find((s) => s.id === "tag")!.status).toBe("done");
});
```
Run: `bun test lib/release/__tests__/release-app-run.test.ts`. Expected: fail (old steps and seams).

- [ ] **Step 2: Cut the module down**

In `lib/release/release-app.ts`:

1. Header comment becomes: "rt release app <name>: a served-app patch release end to end: qualify origin/main for the path fast path, write and commit the notes, tag, and verify the publish. Every step first detects whether it already happened, so a rerun resumes."
2. Delete: `APPS_REPO`, `BUNDLE_PR_AUTHOR`, `BUNDLE_COMMIT_AUTHOR`, `LOCK_PATH`, `PROJECT_YML`, `appAssetUrl`, `appTagFor`, `setPackageVersion`, `eligibleApps`, `qualifyRow`, `isAllowlisted`, `pinOnlyLockProblems`, `RevertedPin`, `revertedPins`, `checkBotPrLock`, `BundleRunInfo`, `botPrOriginProblems`, `teamFromProjectYml`, `checkCodesign`, `ChecksVerdict`, `evaluateChecks`, `bundleRunTargets`, `workspaceGlobs`, `globMatches`, `dependencyNames`, `CatalogUse`, `catalogVersion`, `changedCatalogEntries`, `objectEnd`, `setBunLockWorkspaceVersion`, `HeldApp`, `bumpSubject`, `appsPackage`, `appTagExists`, `heldApps`, `assertFastPath`'s pin-only body, and every seam on `ReleaseAppSeams` that ran `gh workflow run`, polled the bundle run, read or merged the bot PR, or touched the apps repo.
3. `Phase` becomes `"notes" | "released"`; `StepId` becomes `"qualify" | "notes" | "tag" | "verify"`.
4. `qualify(seams, name)` is:

```ts
async function qualify(seams: ReleaseAppSeams, name: string): Promise<Ctx> {
  if (!keepsFastPath(name)) throw new Stop(`${name} is not a served-only app; use the full release process`);
  const { headSha } = await refreshMain(seams);
  const lastTag = newestReleaseTag(await remoteTags(seams));
  const gate = await checkGate(seams, lastTag, "origin/main");
  if (gate.path !== "fast") throw new Stop(`not a fast-path diff since ${lastTag}: ${gate.reason}`);
  const files = (await run(seams, ["git", "diff", "--name-only", `${lastTag}..origin/main`])).split("\n").filter(Boolean);
  const moved = movedServedApps(files);
  if (!moved.includes(name)) throw new Stop(`${name} has not moved since ${lastTag} (moved: ${moved.join(", ") || "none"})`);
  return { name, headSha, lastTag, nextTag: nextPatchTag(lastTag), moved };
}
```
(`Stop` is the module's existing stopped-step error, whatever it is named; `refreshMain` and `remoteTags` stay, minus their deps.lock reads.)
5. Notes: `notesSectionsFor(seams, lastTag, apps)` runs `git log --format=%s <lastTag>..origin/main -- apps/<app>/` per app and maps subjects through `noteSubject`; `renderNotes({ sections, lastTag, nextTag })` drops the held-apps paragraph. The approval flow (`notesHash`, `awaiting-approval`, `--yes-notes`, the notes commit `chore(release): notes for <tag>` pushed to main) is unchanged.
6. Tag: `git tag -a <nextTag> <notesCommitSha> -m <nextTag>` then `git push origin <nextTag>`; verify: `runVerify` as before.
7. `resolvePhase`: if a tag newer than `lastTag` already points at `origin/main` HEAD, phase is `released` (verify only); if the notes commit for `nextTag` is already on main, phase is `notes` resumed at tag; else `notes`.

Run the run tests and `bun test lib/release/__tests__/release-app.test.ts` (delete tests for removed helpers; keep `bumpPatch`, `nextPatchTag`, `noteSubject`, `renderNotes`, `notesHash`). Expected: pass. `bun run typecheck` passes.

- [ ] **Step 3: Trim the command's seams and picker**

In `commands/release.ts`: `createRealReleaseAppSeams` drops the gh workflow, PR and apps-repo seams; `releaseAppOptions` lists the tree rows of `rt-tray/deps.lock` that carry `serve` plus `gitq`, filtered through `keepsFastPath`; `RELEASE_APP_USAGE` unchanged. The `--json` envelope keeps `status`, `steps`, `notes`, `notesHash`, `nextTag`, `resume`.

```bash
bun run cli.ts release app board --dry-run
```
Expected on this branch (no tag since): a `declined` plan whose qualify step names the reason, no side effects.

- [ ] **Step 4: Commit**

```bash
git add lib/release/release-app.ts lib/release/__tests__ commands/release.ts
git commit -m "release app: qualify by path, notes, tag, verify; no bump, bundle or bot PR"
```

### Task 11: update-machine: one shared checkout, deck re-registered, verified against the tree

**Files:**
- Modify: `lib/release/update-machine.ts`, `lib/release/__tests__/update-machine.test.ts`, `commands/release.ts`

**Interfaces:**
- Produces: `UpdateMachineSeams.sharedCheckoutPath` (replaces `appsCheckoutPath`, default `~/Documents/GitHub/repo-tools`); legs in order `prod-app`, `dev-bundle`, `checkout-sync`, `daemon`, `served-suite`, `verify`; `deckVersionAtTag(seams, tag): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

In `lib/release/__tests__/update-machine.test.ts` add, using its fake seams:

```ts
test("checkout-sync refuses a shared checkout off main and halts the daemon leg", async () => {
  const seams = fakeSeams({ branch: "feature-x" });
  const report = await runUpdateMachine(seams, { yes: true });
  const sync = report.legs.find((l) => l.id === "checkout-sync")!;
  expect(sync.status).toBe("aborted");
  expect(report.haltedAfter).toBe("checkout-sync");
});

test("served-suite re-registers a deck app whose registry row points at the old apps checkout", async () => {
  const seams = fakeSeams({ registry: { board: "/Users/x/Documents/GitHub/mattstack-apps/apps/board", chat: "/Users/x/Documents/GitHub/repo-tools/apps/chat" } });
  await runUpdateMachine(seams, { yes: true });
  expect(seams.calls).toContainEqual([seams.deckBin, "register", "--dir", "/Users/x/Documents/GitHub/repo-tools/apps/board"]);
  expect(seams.calls).not.toContainEqual([seams.deckBin, "register", "--dir", "/Users/x/Documents/GitHub/repo-tools/apps/chat"]);
});

test("dev-bundle builds the tree rows before build.sh", async () => {
  const seams = fakeSeams({});
  await runUpdateMachine(seams, { yes: true });
  const i = seams.calls.findIndex((c) => c[0] === "bun" && c[1] === "scripts/build-apps.ts");
  const j = seams.calls.findIndex((c) => c[0] === "rt-tray/build.sh");
  expect(i).toBeGreaterThan(-1);
  expect(i).toBeLessThan(j);
});

test("verify compares deck --version to apps/deck/package.json at the tag", async () => {
  const seams = fakeSeams({ deckVersion: "1.1.2", deckPackageAtTag: "1.1.2" });
  const report = await runUpdateMachine(seams, { verifyOnly: true });
  expect(report.ok).toBe(true);
});
```
Run the file. Expected: fail.

- [ ] **Step 2: Implement**

In `lib/release/update-machine.ts`:

1. Rename `appsCheckoutPath` to `sharedCheckoutPath` (doc comment: "The shared ~/Documents/GitHub/repo-tools checkout the dev daemon and deck's from-source apps run from."). In `commands/release.ts` the real seam becomes `join(homedir(), "Documents", "GitHub", "repo-tools")`.
2. New leg between dev-bundle and daemon:
```ts
const CHECKOUT_SYNC_LABEL = "shared checkout sync";
async function runCheckoutSyncLeg(seams: UpdateMachineSeams): Promise<LegResult> {
  const branch = (await seams.exec(["git", "branch", "--show-current"], { cwd: seams.sharedCheckoutPath })).stdout.trim();
  if (branch !== "main") {
    return abortedLeg("checkout-sync", CHECKOUT_SYNC_LABEL, `${seams.sharedCheckoutPath} is on branch "${branch}", not main; refusing to touch a shared checkout`);
  }
  const pull = await seams.exec(["git", "pull", "--ff-only"], { cwd: seams.sharedCheckoutPath });
  if (pull.exitCode !== 0) return errorLeg("checkout-sync", CHECKOUT_SYNC_LABEL, `git pull failed: ${execTail(pull)}`);
  const install = await seams.exec(["bun", "install", "--frozen-lockfile"], { cwd: seams.sharedCheckoutPath });
  if (install.exitCode !== 0) return errorLeg("checkout-sync", CHECKOUT_SYNC_LABEL, `bun install failed: ${execTail(install)}`);
  return okLeg("checkout-sync", CHECKOUT_SYNC_LABEL, "main pulled and installed");
}
```
Add `"checkout-sync"` to `LegId`, its `describePlannedLeg` text ("pull the shared rt checkout (main only) and bun install --frozen-lockfile"), and run it before the daemon leg; an aborted or error result halts the daemon and served legs like any other.
3. `runServedSuiteLeg` no longer pulls (the sync leg did). Before `deck restart --managed`, for each of `board`, `console`, `chat`, `boxscore`, `deck`: read `~/.mattstack/deck/registry.json` through `seams.readFile`, take `apps.<name>.dev.workingDirectory`; when it is absent or not equal to `${seams.sharedCheckoutPath}/apps/${name}` run `[deck, "register", "--dir", thatPath]`; a non-zero exit is an error leg naming the app.
4. `runDevBundleLeg`: after `fetch-deps.sh` and before `build.sh` run `["bun", "scripts/build-apps.ts", "--arch", "arm64"]` in `bundleDir`, preceded by `["bun", "install", "--frozen-lockfile"]` in `bundleDir` (the clone is fresh).
5. `runVerifyLeg`: replace the `deckPinFromDepsLock` comparison with
```ts
const deckAtTag = await deckVersionAtTag(seams, ctx.tag);
if (deckVersion !== deckAtTag) problems.push(`deck --version is ${deckVersion || "unknown"}, the tree at ${ctx.tag} has ${deckAtTag}`);
```
where
```ts
export async function deckVersionAtTag(seams: UpdateMachineSeams, tag: string): Promise<string> {
  const show = await seams.exec(["git", "show", `${tag}:apps/deck/package.json`], { cwd: seams.sharedCheckoutPath });
  if (show.exitCode !== 0) throw new Error(`git show ${tag}:apps/deck/package.json failed: ${execTail(show)}`);
  return (JSON.parse(show.stdout) as { version: string }).version;
}
```
Delete `deckPinFromDepsLock` and the `repoRoot` deps.lock read; `repoRoot` stays for anything else that uses it.

Run the tests and `bun run typecheck`. Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add lib/release/update-machine.ts lib/release/__tests__/update-machine.test.ts commands/release.ts
git commit -m "update-machine: sync the shared rt checkout, re-register deck apps, verify deck against the tree"
```

### Task 12: Skill, AGENTS.md, docs, leftovers

**Files:**
- Modify: `skills/rt-release/SKILL.md`, `AGENTS.md`, `docs/release-and-distribution.md`, `.github/workflows/checks.yml` (nothing new; verify the actionlint list), `docs/apps/README.md`
- Delete: anything left under `docs/apps/root-*`

- [ ] **Step 1: Rewrite the release skill's release-flow sections**

In `skills/rt-release/SKILL.md` (the in-repo source of `rt:release`):

- Intro blockquote: the cross-repo coordination clause becomes "(deck, board, console, chat, boxscore and gitq build from this tree; fast-browser is the one vendored app in another repo)".
- "Fast path: one served-app fix": replace the first paragraph with: "When the diff since the last tag touches only served-app directories (`apps/board`, `apps/boxscore`, `apps/chat`, `apps/console`, `apps/gitq`), `RELEASE_NOTES.md` and `website/`, the release is one verb, `rt release app <name>`. It qualifies origin/main against that path gate, writes the notes with a section per app that moved, commits them, tags the next patch without the step 8 rehearsal, and runs `rt release verify`." Delete every sentence about bumping the app version, dispatching bundle-apps, the bot deps.lock PR, held apps and pins. Keep the numbered flow (dry run, run, statuses, resume).
- Step 1: the preflight row list drops "per-app pin freshness" and "rt-client npm-vs-source parity"; "the standalone gitq/fast-browser rows" becomes "the fast-browser row".
- Step 2b: replace the whole section with: "**Apps ship at HEAD.** Every bundled app and gitq are built from the tagged commit by `release.yml`'s `build-apps` job (`scripts/build-apps.ts`), so there is no pin to go stale and nothing to bump; a change merged to main is in the next release by construction. Their `package.json` versions are labels nothing reads."
- Step 2c: remove the gitq sentence from "Standalone app rows" and the whole "rt-client" bullet.
- Step 8 "Pin-only fast path": becomes "Path fast path: when `git diff --name-only <last-tag>..HEAD` stays inside the served-app directories, `RELEASE_NOTES.md` and `website/`, skip the local walkthrough and tag on the rehearsal alone. `apps/deck/`, every tool row, fast-browser and any rt file keep the full gate." Keep the `rt release app` paragraph, reworded to the path gate.
- Step 12: the "Served suite" bullet reads from the shared `~/Documents/GitHub/repo-tools` checkout, and a new "Shared checkout sync" bullet before "Daemon" describes the pull and install; "Dev bundle" adds `bun scripts/build-apps.ts` between fetch-deps and build.sh; "Verify" compares `deck --version` to `apps/deck/package.json` at the tag.

Run `scripts/repo-purity.sh`, and compare the em-dash count of the file before and after the edit (`git show HEAD:skills/rt-release/SKILL.md | grep -c $'\xe2\x80\x94'` against the working copy): it must not grow.

- [ ] **Step 2: Root AGENTS.md**

Add a section after "Repo identity":

```markdown
## Monorepo layout

rt is the root package. `apps/*` (board, boxscore, chat, console, deck, gitq)
and the apps platform packages under `packages/*` came from the apps repo and
keep their own contract in `apps/AGENTS.md` (catalog rules, turbo, per-app
scripts, UI authoring). Turborepo (`turbo.json`, `scripts/turbo.sh`) runs
their gates and rt's static gates; `bun run check` is what `checks.yml`'s
`static` job runs. rt's unit suite is `bun run test` and never walks the apps'
vitest packages: the `test` script names rt's directories one by one, and
`scripts/ci/test-scope.ts` skips the macOS shards on a PR that touches only
apps trees. Deck serves the apps from this checkout in dev mode
(`deck register --dir ~/Documents/GitHub/repo-tools/apps/<name>`), and the
release builds them at the tagged commit (`scripts/build-apps.ts`, the
`build-apps` job in `release.yml`); `rt-tray/deps.lock` lists them as
`source: "tree"` rows, which is deck's served-app catalog.
```
In "Getting a change into the running dev app", replace the first bullet's checkout path with `~/Documents/GitHub/repo-tools` and note that `rt release update-machine` re-registers the apps. In the "Tray and shim changes" bullet insert `bun scripts/build-apps.ts` after `scripts/fetch-deps.sh arm64`. In the footgun "`bun run test` is one of three suites" add: "The apps' packages under `packages/*` and `apps/*` are vitest or their own bun suites and are never in the unit dirs; run them with `bun run <app>:test` or `bun run check`."

- [ ] **Step 3: Release docs and README**

In `docs/release-and-distribution.md` find the paragraph describing bundle-apps and deps.lock pins and replace it with two sentences: the apps are built in-tree by `build-apps`, and deps.lock's tree rows carry no url. `docs/apps/README.md`: replace its "rt identity" and "Publishing" notes with one line pointing at the root README; fix any `../rt` relative links.

- [ ] **Step 4: Sweep**

```bash
git ls-files docs/apps | grep root- || echo none
grep -rn "bundle-apps\|APPS_REPO\|mattstack-apps" lib commands scripts skills AGENTS.md docs/release-and-distribution.md .github | grep -v "__tests__" || echo clean
bun run test 2>&1 | tail -3
scripts/turbo.sh check --output-logs=errors-only
```
Expected: `none`, `clean` (a remaining hit is a leftover to fix), both suites green.

- [ ] **Step 5: Commit**

```bash
git add skills/rt-release/SKILL.md AGENTS.md docs
git commit -m "docs: the release skill and AGENTS.md describe the in-tree apps"
```

### Task 13: Stage A cutover (Matt-gated)

No code. Each step needs Matt's go; stop after each and report.

- [ ] **Step 1: Open the PR** from the branch with `gh pr create`, title `monorepo: absorb m4ttstack/apps`, body per the repo's PR conventions. Wait for green `checks`, `e2e`, `purity` and the review (CodeRabbit, or an opus subagent review when it is rate-limited).
- [ ] **Step 2: Merge** (squash) on Matt's confirmation.
- [ ] **Step 3: Release** from the merged main with the `rt:release` skill: full gate (rehearsal plus local walkthrough), then tag. This release proves the in-tree build path end to end.
- [ ] **Step 4: Update this machine**: `rt release update-machine` (it re-registers the five deck apps at the rt checkout).
- [ ] **Step 5: Archive the apps repo**: `gh repo archive m4ttstack/apps --yes`.
- [ ] **Step 6: Local cleanup**: dispose every rt worktree of the app-kit identity (`rt worktree list`, then `rt worktree dispose <tree>` for each), remove the `remote:github.com%2Fm4ttstack%2Fapp-kit` binding from `~/.mattstack/rt/repos.json` (with the daemon stopped, or through the rt verb that untracks a repo if one exists: `rt repo --help`), delete `~/Documents/GitHub/mattstack-apps`.
- [ ] **Step 7: README links** in `mattstack-skills/README.md:12-14` and `fast-browser/README.md:25-26` still point at gitq and glance, which move in Stages B and C; leave them for those stages.

---

## Stage B: glance

### Task 14: Import glance with history

**Files:**
- Create: `packages/glance/**`, `packages/glance-react/**`, `packages/typescript-config/**`, `docs/glance/**`, `packages/glance/AGENTS.md`, `packages/glance/harness_credentials.example.json`

- [ ] **Step 1: Clone and rewrite**

```bash
SCRATCH="$(mktemp -d)/glance-import"
git clone --single-branch --branch main https://github.com/m4ttstack/glance.git "$SCRATCH"
cd "$SCRATCH"
git filter-repo --force --invert-paths --path CLAUDE.md --path LICENSE --path bun.lock --path package.json --path .gitignore --path packages/glance-react/.github
git filter-repo --force \
  --path-rename README.md:docs/glance/README.md \
  --path-rename AGENTS.md:packages/glance/AGENTS.md \
  --path-rename docs/:docs/glance/ \
  --path-rename harness_credentials.example.json:packages/glance/harness_credentials.example.json
git ls-files | grep -vE '^(packages/|docs/glance/)' || echo "root clean"
```
Expected: `root clean`.

- [ ] **Step 2: Merge**

From the rt worktree (a fresh one off main, after Stage A shipped):
```bash
git remote add glance-import "$SCRATCH"
git fetch glance-import main
git merge --allow-unrelated-histories --no-ff -m "monorepo: import m4ttstack/glance main with history" glance-import/main
git remote remove glance-import
git status --short | head
```
Expected: clean merge. Prepend to `packages/glance/AGENTS.md`: `> Scope: packages/glance and packages/glance-react. This was the glance repo's contract before the fold-in.`

- [ ] **Step 3: Commit the scope note**

```bash
git add packages/glance/AGENTS.md
git commit -m "glance: scope the imported AGENTS.md"
```

### Task 15: glance is a workspace package everywhere

**Files:**
- Modify: `package.json` (root), `packages/glance/package.json`, `packages/glance-react/package.json`, `packages/rt-client/package.json`, `apps/board/package.json`, `apps/boxscore/package.json`, `apps/chat/package.json`, `apps/console/package.json`, `apps/deck/package.json`, `packages/server/package.json`, `extensions/vscode/rt-context/package.json`, `.github/workflows/release.yml`, `.github/renovate-global.json5`, `.gitignore`, `.prettierignore`, `packages/glance/tests/live/credentials.ts`, `packages/glance/tests/live/probe/githubEventsProbe.ts`, `scripts/ci/test-scope.ts`
- Delete: `extensions/vscode/rt-context/bun.lock`

- [ ] **Step 1: Catalog and consumers**

Root `package.json`:
- Remove `"@mattstack/glance": "^0.27.0"` from `workspaces.catalog`; add the glance catalog entries that are absent: `"@tailwindcss/vite": "^4.2.1"`, `"babel-plugin-react-compiler": "^1.0.0"`, `"class-variance-authority": "^0.7.1"`, `"clsx": "^2.1.1"`, `"lucide-react": "^0.577.0"`, `"radix-ui": "^1.4.3"`, `"tailwind-merge": "^3.5.0"`, `"tailwindcss": "^4.2.1"`, `"tw-animate-css": "^1.4.0"`, `"vite-tsconfig-paths": "^6.1.1"`.
- `dependencies["@mattstack/glance"]` becomes `"workspace:*"` (the root lists it once, under `dependencies`; rt's own code imports it).
- `workspaces.packages` gains `"extensions/vscode/rt-context"`.

Consumers: every `"@mattstack/glance": "catalog:"` in `apps/*` and `packages/server` becomes `"workspace:*"` (`grep -rln '"@mattstack/glance": "catalog:"' apps packages`). `packages/rt-client/package.json`: keep the peer range and add `"devDependencies": { "@mattstack/glance": "workspace:*" }` (merge with existing devDependencies if any). `extensions/vscode/rt-context/package.json`: both `@mattstack/*` deps become `"workspace:*"`; `git rm extensions/vscode/rt-context/bun.lock`.

glance packages: `packages/glance/package.json` devDependencies `"typescript": "^5.9.3"` (explicit, not catalog) and add scripts `"typecheck": "bun run check-types"`, `"test": "bun test tests"`. `packages/glance-react/package.json`: `"typescript": "^5.9.3"`, `"vite": "^7.3.1"`, `"@vitejs/plugin-react": "^5.1.4"` explicit; the tailwind, radix, clsx, cva, lucide, tw-animate, tailwind-merge entries stay `catalog:`; `react`/`react-dom` peers `catalog:`; add `"typecheck": "bun run check-types"`; in `build` replace `npx @tailwindcss/cli` with `bunx @tailwindcss/cli`; align its `storybook`, `@storybook/*`, `playwright`, `@vitest/browser`, `@vitest/coverage-v8`, `vitest`, `happy-dom` versions to the ranges the root and `packages/tui-kit` already use (read them; a second major of storybook or playwright in one workspace collides on `.bin`).

Add to `apps/AGENTS.md`'s catalog-rules paragraph: "`packages/glance` and `packages/glance-react` pin TypeScript 5.9 and vite 7 explicitly, the third documented exception, until they are bumped in their own PR."

- [ ] **Step 2: Paths, ignores, scope**

`packages/glance/tests/live/credentials.ts:129`:
```ts
const DEFAULT_PATH = new URL('../../harness_credentials.json', import.meta.url).pathname;
```
`packages/glance/tests/live/probe/githubEventsProbe.ts:49`:
```ts
const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
```
(both now resolve to `packages/glance/`). Root `.gitignore` gains:
```
# glance live-harness credentials: real tokens, never committed
packages/glance/harness_credentials.json
*.tsbuildinfo
```
`.prettierignore` gains `/packages/glance` and `/packages/glance-react` (they carry their own formatter config).

`scripts/ci/test-scope.ts`: rt imports `@mattstack/glance` at 23 sites, so a change under `packages/glance/` must run rt's suite; `packages/glance-react/`, `packages/typescript-config/` and `docs/glance/` are the shards' business no more than the apps are. Add `"glance-react", "typescript-config"` to `APPS_PACKAGES` and `f.startsWith("docs/glance/")` to `isAppsTree`. Extend the Task 5 tests:
```ts
test("a glance source change runs rt's unit suite", () => {
  expect(decide(prInput(["packages/glance/src/index.ts"])).mode).not.toBe("skip");
});
test("glance-react and typescript-config are apps trees", () => {
  expect(decide(prInput(["packages/glance-react/lib/x.tsx", "packages/typescript-config/base.json", "docs/glance/README.md"])).mode).toBe("skip");
});
```

- [ ] **Step 3: release.yml and renovate**

`release.yml`: in the `Build extension` step delete the `bun install` line (the root install already covers the extension). `.github/renovate-global.json5`: delete `"m4ttstack/glance"` if present (it is not; nothing to do) and delete the `ignorePaths: ["extensions/vscode/rt-context/**"]` line and its header sentence (the extension is a workspace member on `workspace:*`; there is nothing for renovate to bump).

- [ ] **Step 4: Install, build, test**

```bash
bun install
bun install --frozen-lockfile
scripts/turbo.sh build --filter=@mattstack/glance --filter=@mattstack/glance-react --output-logs=errors-only
scripts/turbo.sh typecheck test --output-logs=errors-only
bun run typecheck
bun run test 2>&1 | tail -3
scripts/repo-purity.sh
(cd extensions/vscode/rt-context && bun run package && ls *.vsix)
```
Expected: all green; a `.vsix` is produced. `grep -rn '"@mattstack/glance": "\^' apps packages package.json extensions` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add -A package.json bun.lock packages apps extensions .github .gitignore .prettierignore scripts/ci
git commit -m "monorepo: glance is a workspace package; the VS Code extension joins the workspace"
```

### Task 16: glance publishes on demand with bun

**Files:**
- Create: `packages/glance/docs/releasing.md`
- Modify: `packages/glance/AGENTS.md` (the release paragraph)

- [ ] **Step 1: Write the release doc**

`packages/glance/docs/releasing.md`:

```markdown
# Releasing @mattstack/glance and @mattstack/glance-react

Both packages are consumed inside this repo as `workspace:*`; a publish
exists only for a consumer outside it. Publish from a checkout on `main`,
from the package directory, with `bun publish` and never `npm publish`:
glance-react depends on glance as `workspace:*`, which bun rewrites to the
version in the tree and npm ships verbatim.

1. Bump `version` in the package's `package.json` and add a CHANGELOG entry.
2. `bun run build` in the package, then `bun run check-types`.
3. `bun publish` (OTP prompt). For glance-react, glance's current version must
   already be on npm: `npm view @mattstack/glance@<version> version`.
4. Commit the bump: `glance: publish <version>`.
```
In `packages/glance/AGENTS.md`, replace the `npm publish` sentence in the release section with a pointer to `docs/releasing.md`.

- [ ] **Step 2: Commit**

```bash
git add packages/glance/docs/releasing.md packages/glance/AGENTS.md
git commit -m "glance: publish on demand with bun publish"
```

### Task 17: Stage B cutover (Matt-gated)

- [ ] **Step 1: PR**, review, green CI, squash-merge on Matt's confirmation.
- [ ] **Step 2: Release** with the full gate (rt code changed: the glance link).
- [ ] **Step 3: `gh repo archive m4ttstack/glance --yes`**; remove the `remote:github.com%2Fm4ttstack%2Fglance` binding from `~/.mattstack/rt/repos.json`; dispose its worktrees; delete `~/Documents/GitHub/glance`.
- [ ] **Step 4: README links**: in `mattstack-skills/README.md` and `fast-browser/README.md` point the glance link at `https://github.com/m4ttstack/rt/tree/main/packages/glance` (a direct commit on each repo's main; both are docs-only).

---

## Stage C: gitq

### Task 18: Import gitq with history

**Files:**
- Create: `apps/gitq/**`

- [ ] **Step 1: Clone and rewrite**

```bash
SCRATCH="$(mktemp -d)/gitq-import"
git clone --single-branch --branch main https://github.com/m4ttstack/gitq.git "$SCRATCH"
cd "$SCRATCH"
git filter-repo --force --invert-paths --path bun.lock --path .github
git filter-repo --force --to-subdirectory-filter apps/gitq
git ls-files | grep -v '^apps/gitq/' || echo "all under apps/gitq"
```
Expected: `all under apps/gitq`. `LICENSE`, `README.md`, `docs/`, `website/`, `skills/`, `.gitignore` stay inside `apps/gitq` (the npm package ships `LICENSE` and `README.md`).

- [ ] **Step 2: Merge**

```bash
git remote add gitq-import "$SCRATCH"
git fetch gitq-import main
git merge --allow-unrelated-histories --no-ff -m "monorepo: import m4ttstack/gitq main with history" gitq-import/main
git remote remove gitq-import
git status --short | head
```
Expected: clean.

### Task 19: gitq is a workspace app; its npm bundle carries rt-client

**Files:**
- Modify: `apps/gitq/package.json`, `apps/gitq/scripts/release.ts`, `apps/gitq/mattstack.deck.json`, `apps/gitq/docs/releasing.md`, `rt-tray/deps.lock`, `lib/release/preflight.ts`, `lib/release/__tests__/preflight.test.ts`, `.github/renovate-global.json5`, `.github/workflows/release.yml`, `scripts/ci/test-scope.ts`
- Create: `apps/gitq/tests/npm-bundle.test.ts`

- [ ] **Step 1: Write the failing bundle test**

`apps/gitq/tests/npm-bundle.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const ROOT = join(import.meta.dir, '..');

describe('npm bundle', () => {
  test('dist/gitq.js carries rt-client and imports only published packages', () => {
    const build = spawnSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
    expect(build.status).toBe(0);
    const js = readFileSync(join(ROOT, 'dist', 'gitq.js'), 'utf8');
    expect(js).not.toMatch(/from\s+["']@mattstack\/rt-client/);
    expect(js).not.toMatch(/from\s+["']@mattstack\/settings-kit/);
    const deps = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies as Record<string, string>;
    for (const name of Object.keys(deps)) expect(deps[name]).not.toMatch(/^(file|link):/);
    const smoke = spawnSync('node', [join(ROOT, 'dist', 'gitq.js'), '--version'], { stdio: 'pipe' });
    expect(smoke.status).toBe(0);
  });
});
```
Run from `apps/gitq`: `bun test tests/npm-bundle.test.ts`. Expected: fails (rt-client is still an external import).

- [ ] **Step 2: Manifest**

`apps/gitq/package.json`:
- `dependencies`: `"@mattstack/glance": "workspace:*"`, `"picomatch": "^4.0.2"`, plus rt-client's runtime deps so the bundled copy can resolve them: `"@cfworker/json-schema"` and `"jsonc-parser"` at the ranges in `packages/rt-client/package.json`.
- `devDependencies`: add `"@mattstack/rt-client": "workspace:*"`; `"typescript": "^5.9.3"` stays explicit.
- `scripts.build`: `bun build src/cli/main.ts --outfile dist/gitq.js --target node --format esm --external @mattstack/glance --external picomatch --external @cfworker/json-schema --external jsonc-parser`
- add `"typecheck": "bun run check-types"`.
`apps/gitq/mattstack.deck.json`: `bundle.build` becomes `bun run build:binary`.

Run the bundle test again. Expected: pass. Then `bun install`, `bun install --frozen-lockfile`, `scripts/turbo.sh typecheck test --filter=@mattstack/gitq --output-logs=errors-only`. Expected: pass (the integration suite included).

- [ ] **Step 3: The release script**

In `apps/gitq/scripts/release.ts`:
- The tag becomes `gitq-v${next}` everywhere the script creates or pushes a tag (a bare `v*` tag would trigger rt's mattstack.app release). Update `docs/releasing.md` in the same way.
- Extend the guard: `fileDependencies` also returns names whose spec starts with `link:`; add after it:
```ts
export function workspaceDependencies(pkg: { dependencies?: Record<string, string> }): string[] {
  return Object.entries(pkg.dependencies ?? {})
    .filter(([, spec]) => spec.startsWith('workspace:'))
    .map(([name]) => name);
}
```
and in `main`, after the file-dep check, for each workspace dependency read `../../packages/<basename of the name>/package.json`'s `version` and run `npm view <name>@<version> version`; die with `<name>@<version> is not on npm; publish it first` when the command fails. (bun publish rewrites `workspace:*` to that version, so it must exist for installers.)
- `git` checks (`main`, clean, in sync) run at the repo root; leave `run` with `cwd: ROOT` since git resolves the repository from any subdirectory.
Add a unit test next to the existing ones for `workspaceDependencies`.

- [ ] **Step 4: deps.lock, preflight, renovate, release.yml, scope**

`rt-tray/deps.lock` gitq row becomes:
```json
    { "name": "gitq", "version": "", "license": "MIT", "source": "tree",
      "archive": "raw", "extract": "", "bundlePath": "Contents/Helpers/gitq", "exec": ["Contents/Helpers/gitq"],
      "exposeByDefault": true, "entitlements": "jit", "status": "bundled", "kind": "helper" },
```
(no `serve`: gitq ships as a tool; no `skills`: its raw release never carried them.)

`lib/release/preflight.ts`: `STANDALONE_REPOS` loses `gitq`; the doc comment reads "fast-browser's deps.lock url is npm, so its repo is declared here". Update the preflight test that classified gitq as standalone to expect it absent when `source: "tree"`.

`.github/renovate-global.json5`: delete `"m4ttstack/gitq",`. `release.yml`: the `Fetch bundled dependencies` step's `GH_TOKEN` env and comment go (every remaining fetched row is a public download).

`scripts/ci/test-scope.ts`: nothing; `apps/gitq/` is under `apps/` already.

```bash
bun scripts/build-apps.ts
scripts/fetch-deps.sh arm64
bun run test 2>&1 | tail -3
```
Expected: gitq builds into `rt-tray/deps/arm64/gitq`; fetch-deps prints the tree-row skip for gitq; rt's suite passes.

- [ ] **Step 5: Commit**

```bash
git add apps/gitq rt-tray/deps.lock lib/release .github package.json bun.lock
git commit -m "monorepo: gitq is a workspace app built in-tree; its npm bundle carries rt-client"
```

### Task 20: gitq docs and the skill's last cross-repo lines

**Files:**
- Modify: `apps/gitq/README.md` (repo links, `bun run release` path), `apps/gitq/docs/releasing.md`, `skills/rt-release/SKILL.md` (any remaining gitq-as-standalone sentence), `AGENTS.md` (the Monorepo layout section already lists gitq; verify)

- [ ] **Step 1: Sweep**

```bash
grep -rn "m4ttstack/gitq\|m4ttstack/glance\|m4ttstack/apps" --include='*.md' --include='*.ts' --include='*.yml' --include='*.json5' . 2>/dev/null | grep -v -E "node_modules|docs/(apps|glance)/superpowers|apps/gitq/docs/superpowers|/CHANGELOG" || echo clean
```
Fix each hit that is a live instruction (a README install line, a workflow, a skill); leave dated superpowers docs and changelogs.

- [ ] **Step 2: Commit**

```bash
git add -A apps/gitq/README.md apps/gitq/docs skills AGENTS.md
git commit -m "docs: gitq lives in apps/gitq"
```

### Task 21: Stage C cutover (Matt-gated)

- [ ] **Step 1: PR**, review, green CI, squash-merge on Matt's confirmation.
- [ ] **Step 2: Release** with the full gate (deps.lock and rt code changed).
- [ ] **Step 3: `gh repo archive m4ttstack/gitq --yes`**; remove the `remote:github.com%2Fm4ttstack%2Fgitq` binding from `~/.mattstack/rt/repos.json`; dispose its worktrees; delete `~/Documents/GitHub/gitq`.
- [ ] **Step 4: README links** in `mattstack-skills/README.md` and `fast-browser/README.md` point the gitq link at `https://github.com/m4ttstack/rt/tree/main/apps/gitq`.
- [ ] **Step 5: Memory and docs**: `docs/architecture.md` in rt gains one line that apps, glance and gitq live in this repo; the memory files `project_rt_client_package.md` and `reference_repo_tools_e2e_not_in_test.md` get a dated line that rt-client is no longer published and the apps are in-tree.

---

## Self-review notes

- Spec coverage: Layout (Tasks 1, 14, 18), Workspace (2, 3, 15, 19), Tasks and CI (4, 5), Release (6, 7, 8, 9, 10, 12), Dev machine (11, 13), Migration (1, 13, 14, 17, 18, 21), Non-goals honored (no rename, no per-app channel, no git-core sharing). One correction to the spec: `lib/setup/steps/deck.ts:95` writes board's runtime working directory under `~/.mattstack/board`, not a checkout path, so it needs no change; Task 11 covers the checkout repoint through deck's registry instead.
- Types: `DepsLockTool.source`/`skills` (Task 6) are what Task 7's script, Task 9's `classifyRows` and Task 19's row rely on; `SERVE_ONLY_APPS`/`movedServedApps`/`keepsFastPath` (Task 9) are what Task 10 consumes; `sharedCheckoutPath` (Task 11) is what the skill text in Task 12 describes.
- Review Focus items 1 to 6 each have a named test in Tasks 5, 6, 6, 9, 10 and 19.
