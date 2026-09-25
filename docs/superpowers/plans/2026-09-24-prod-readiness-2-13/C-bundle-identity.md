# Unit C: bundled apps carry their identity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a clean 2.13.0 install every served app (board, chat, console, boxscore) shows its display name, description, badge and icon in deck's `/api/apps` and on the deck board, with no source checkout linked, because the identity ships in the bundle at `Contents/Resources/apps/<name>/`.

**Architecture:** Identity travels the same road skills already travel. `bundle-apps.yml` (repo-tools) stages an identity-only `mattstack.deck.json` plus the icon it names into the app tarball as `identity/`, read from source before the recipe runs. `fetch-deps.sh` materializes it as `rt-tray/deps/arm64/<name>-identity/` under its own sha stamp. `build.sh` lands it at `Contents/Resources/apps/<name>/` for exactly the deps.lock rows that carry `serve`, and `check-bundle.sh` asserts that set both ways. Deck (mattstack-apps) reads it at request time: a new `registry/bundled-identity.ts` resolves a row's effective identity (a linked checkout's ingested identity wins; otherwise the bundle's copy; otherwise the stored fields), and `/api/apps`, `/api/apps/:name/icon`, `/api/v1/status` and `/api/v1/apps` all read through it. Nothing is written to the registry, so the older deck pinned in the other flavor is unaffected.

**Tech Stack:** Bun + TypeScript (bun:test), bash (fetch-deps.sh, build.sh, check-bundle.sh), GitHub Actions YAML (actionlint).

**Spec:** /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/faramir/docs/superpowers/specs/2026-09-24-prod-readiness-2-13-design.md (section C; Order step 2; Risks "Deck version skew").

---

## Global Constraints

- Two PRs, one per repo:
  - **PR C-apps** in `m4ttstack/apps`, branch `apps-2-13-c-bundle-identity`, Tasks 1 to 7.
  - **PR C-rt** in `m4ttstack/rt` (repo-tools), branch `rt-2-13-c-bundle-identity`, Tasks 8 to 13.
  - The two PRs have no code dependency on each other, but each has a predecessor: PR C-apps branches after unit B merges (it reuses B's `bundleResourcesDir`), and PR C-rt branches after unit A merges (it reads A's `DepsLockTool.serve` directly). Merge order is in "Merge and release order" below.
- Shared checkouts are READ ONLY: `~/Documents/GitHub/repo-tools` and `~/Documents/GitHub/mattstack-apps` stay on whatever branch they are on. Never switch, commit, or write there (Task 1 only adds a worktree to mattstack-apps' git metadata).
- mattstack-apps work happens only in `/Users/matt/Documents/GitHub/mattstack-apps/.claude/worktrees/apps-2-13-c-bundle-identity` (created in Task 1 from `origin/main`), from a Claude session rooted in mattstack-apps (an `rt pane spawn` there, or `/cd /Users/matt/Documents/GitHub/mattstack-apps` then EnterWorktree in path mode on that worktree). Never run C-apps as a subagent of the repo-tools worktree session: EnterWorktree cannot cross repos, and a subagent inherits its parent's Bash guard.
- repo-tools work happens only in a fresh rt worktree (EnterWorktree name-mode, name `rt-2-13-c-bundle-identity`), on branch `rt-2-13-c-bundle-identity` created from `origin/main`. This unit changes no Swift, so no `rt-tray/deps` or `rt-tray/vm/.cache` copy is needed.
- **Worktree Bash guard (both halves).** An EnterWorktree session refuses heredocs, `&&` chains, `cd <dir> && ...`, `git -C`, `$(...)` scratch dirs and shell loops. Every command below is one plain command per Bash call, run from the worktree root: deck tests take `bun test --cwd apps/deck <files>` (which loads `apps/deck/bunfig.toml`), scratch files live under `<scratchpad>` (the session scratchpad), and PR bodies are written with the Write tool and passed with `--body-file`.
- TDD on every code step: write the failing test first, run it and see the named failure, then implement, then see it pass.
- Verification is targeted only. Never run `bun run test`, `bun run test:all`, `bun run deck:test` or any full suite. The exact commands are named per step.
- Clean-code comments only: a comment states a constraint the code cannot show (parity anchor, trap, non-obvious invariant). No narration, no ticket ids, no decision history in code.
- No em dashes or en dashes anywhere (code, comments, commit messages, PR bodies). Use "..." or rephrase.
- Never run a built rt, deck or app binary except under `env -i HOME=<tmp> ...`. This unit builds none. Never touch `/Applications/*.app` or `rt-tray/mattstack-dev.app`, and never run `rt-tray/build.sh` in this unit.
- Commit after every task, with two `-m` flags: the message first, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` last.
- mattstack-apps CI runs `prettier --check .` at the root: run `bunx prettier --write` and then `bunx prettier --check` on every touched `.ts`, `.json` and `.md` file before each C-apps commit (the steps name them).
- Deck version: do NOT bump `apps/deck/package.json` (unit B bumps it to 1.1.0). This unit bumps board, chat and console only (Task 6).
- Unit B rewrites `reresolveManagedApps` (`apps/deck/src/api/register.ts:437-503`) and may filter not-served rows in `buildDiscoveryApps`. This unit does not touch `register.ts` at all, and its `discovery.ts` edit is confined to the pushed object's fields and `iconResponse`.

## Review Focus

Five failure modes the spec implies that nothing tests today. Each is pinned by a named test in its owning task.

1. **An icon path that escapes the identity dir** (`../../x.svg`, an absolute path, a dotted directory) in a staged or bundled manifest. Deck must not serve a file outside `Resources/apps/<name>/`, and staging must refuse it before a release is immutable. Pinned in Task 2 (`an icon path that escapes the identity dir is refused`) and Task 8 (`icon paths that escape, are absolute, or cross a dotted dir are refused`).
2. **Precedence on a machine that lived in dev mode.** A linked row whose identity was ingested from its checkout must keep that identity when prod serves it from the bundle, and an unlinked row with stale stored fields must show the bundle's. Pinned in Task 3 (`a linked row with an ingested identity keeps it`, `bundled identity replaces a stale stored identity on an unlinked row`) and Task 4 (`a linked row keeps the identity ingested from its checkout`).
3. **An icon deck would reject** (over 64 KB, not svg-rooted, missing). Deck must advertise `icon: null` rather than a URL that 404s, and bundle-apps must fail the leg rather than ship it. Pinned in Task 2 (`an oversize or non-svg bundled icon yields no identity`) and Task 8 (`a declared icon that is missing, oversize or not svg fails staging`).
4. **Resources/apps drifting from the served set.** A deps.lock row with `serve` whose pinned archive predates identity (board/chat/console today), or a `Resources/apps/<x>` that no served row declares, must fail check-bundle with a remediation. Pinned in Task 11 (`check names a served row with no identity and a stowaway dir`).
5. **A stale identity surviving a pin change.** When a new pin's archive carries no `identity/`, the previous pin's `deps/arm64/<name>-identity` and its stamp must go, and a deleted identity dir under a valid stamp must re-materialize. Pinned in Task 10 (`a new pin without identity clears the old identity and its stamp`, `a deleted identity dir re-materializes despite a valid stamp`).

## Files

**PR C-apps (`/Users/matt/Documents/GitHub/mattstack-apps/.claude/worktrees/apps-2-13-c-bundle-identity`)**

| File | Change |
|---|---|
| `apps/deck/src/registry/manifest.ts` | Extract `readSvgIcon(path)`; `ingestManifest` uses it (`bundleResourcesDir` is unit B's, already on `main`) |
| `apps/deck/src/registry/manifest.test.ts` | Tests for `readSvgIcon` |
| `apps/deck/src/registry/bundled-identity.ts` | NEW: `readBundledIdentity`, `effectiveIdentity`, `statusIconUrl`, `setBundledResourcesDir` |
| `apps/deck/src/registry/bundled-identity.test.ts` | NEW |
| `apps/deck/src/registry/__fixtures__/bundle-resources/apps/board/mattstack.deck.json` | NEW twin fixture (byte-identical to repo-tools) |
| `apps/deck/src/registry/__fixtures__/bundle-resources/apps/board/src/favicon.svg` | NEW twin fixture (byte-identical to repo-tools) |
| `apps/deck/src/api/discovery.ts` | `buildDiscoveryApps` and `iconResponse` read through `effectiveIdentity` |
| `apps/deck/src/api/discovery.test.ts` | Bundled identity tests |
| `apps/deck/src/api/status.ts` | Row `icon` via `statusIconUrl` |
| `apps/deck/src/api/status.test.ts` | Test |
| `apps/deck/src/api/server.ts` | `rowFor` `icon` via `statusIconUrl` |
| `apps/deck/src/api/server.test.ts` | Test |
| `apps/deck/docs/manifest.md` | Document bundled identity |
| `apps/board/package.json`, `apps/chat/package.json`, `apps/console/package.json`, `bun.lock` | Patch bumps so bundle-apps can re-release them with identity |

**PR C-rt (rt worktree `rt-2-13-c-bundle-identity`)**

| File | Change |
|---|---|
| `scripts/lib/app-identity.ts` | NEW: validation, staged form, `stageIdentity`, `landIdentities`, `checkIdentities`, `land`/`check` CLI |
| `scripts/lib/__tests__/app-identity.test.ts` | NEW |
| `scripts/lib/__tests__/fixtures/bundle-resources/apps/board/mattstack.deck.json` | NEW twin fixture |
| `scripts/lib/__tests__/fixtures/bundle-resources/apps/board/src/favicon.svg` | NEW twin fixture |
| `scripts/bundle-ci/stage-identity.ts` | NEW: stage CLI for bundle-apps |
| `scripts/bundle-ci/__tests__/stage-identity.test.ts` | NEW |
| `.github/workflows/bundle-apps.yml` | Stage identity before the recipe; add it to the tarball |
| `scripts/fetch-deps.sh` | Materialize `<name>-identity` with its own stamp |
| `scripts/__tests__/fetch-deps-identity.test.ts` | NEW |
| `rt-tray/build.sh` | Land identity into `Contents/Resources/apps/` |
| `rt-tray/check-bundle.sh` | Assert identity for exactly the served rows |
| `docs/release-and-distribution.md` | Document the identity channel |

## Merge and release order

This follows the README's merge order (steps 3 and 5).

1. PR C-apps branches from `main` after unit B merges and imports B's `bundleResourcesDir` (it adds no copy of its own). It merges after B, and its board 0.1.6, chat 0.1.3 and console 0.1.3 bumps ride it. Deck with no `Resources/apps` falls back to today's stored identity.
2. PR C-rt branches from `main` after unit A merges, so `serve` is already on `DepsLockTool` and on the board, chat and console rows (boxscore's row is pending, which `landIdentities` and `checkIdentities` skip). **From the moment C-rt merges, `check-bundle.sh` rejects any served row without identity, and board, chat and console are still pinned to pre-identity tarballs, so no release or rehearsal is cut until the bot deps.lock PR from the release runbook's dispatch merges** (unit A's pending boxscore row already blocks releases through `checkAppPins` for the same window).
3. Both PRs, plus B and D, merge **before** the release runbook's single `bundle-apps` dispatch (`I-release-runbook.md`). That dispatch lists `deck,boxscore,board,chat,console` (not only deck and boxscore): board 0.1.5, chat 0.1.2 and console 0.1.2 are pinned to tarballs built before identity existed, and Task 6's bumps are what let the tag guard (`bundle-apps.yml:119-131`) release them again.
4. The resulting bot deps.lock PR pins all five new tarballs in one change and leaves every `serve` field as it is. Once it merges, every served row carries identity and the release build passes `check-bundle.sh`.

---

## PR C-apps (m4ttstack/apps)

### Task 1: The shared svg check, on top of unit B

**Files:**
- Modify: `apps/deck/src/registry/manifest.ts` (lines 43-53 constants and `looksLikeSvg`; lines 114-123 inside `ingestManifest`)
- Modify: `apps/deck/src/registry/manifest.test.ts`

**Interfaces:**
- Consumes: unit B's `bundleResourcesDir(execPath?: string): string | null` in `apps/deck/src/services/bundle-layout.ts` (absolute `<root>/Contents/Resources`, or null outside a bundle), already on `main`. This unit adds no second copy.
- Produces:
  - `export function readSvgIcon(path: string): string | null` (svg text when the file exists, is at most 64 KB and is svg-rooted; else null).

- [ ] **Step 1: Create the worktree on a main that holds unit B, and install**

Start from a session rooted in `/Users/matt/Documents/GitHub/mattstack-apps` (see Global Constraints). Confirm B has merged:

```bash
gh pr list --repo m4ttstack/apps --head apps-2-13-b-deck-sweep --state merged --json number,mergedAt
```

Expected: one entry. If it prints `[]`, stop and report: this PR builds on B.

From the shared checkout's root (these two commands write only its git metadata):

```bash
git fetch origin main
git worktree add -b apps-2-13-c-bundle-identity .claude/worktrees/apps-2-13-c-bundle-identity origin/main
```

`.claude/worktrees/` is already excluded (`**/.claude/worktrees/` in `.git/info/exclude`). Enter the tree with EnterWorktree in path mode on `/Users/matt/Documents/GitHub/mattstack-apps/.claude/worktrees/apps-2-13-c-bundle-identity`, then, from its root:

```bash
bun install --frozen-lockfile
grep -n "export function bundleResourcesDir" apps/deck/src/services/bundle-layout.ts
```

Expected: the install exits 0 and the grep prints B's function. All later C-apps commands run from this worktree root (written `$WT` in prose below).

- [ ] **Step 2: Write the failing tests**

In `apps/deck/src/registry/manifest.test.ts`, add `readSvgIcon` to the import from `./manifest.ts` (lines 12-17) and append:

```ts
test('readSvgIcon returns svg text only for an svg-rooted file of at most 64 KB', () => {
  const dir = repo({
    'ok.svg': SVG,
    'prolog.svg': `<?xml version="1.0"?>\n${SVG}`,
    'big.svg': `<svg>${' '.repeat(64 * 1024)}</svg>`,
    'png.svg': 'PNG not an svg',
  });
  expect(readSvgIcon(join(dir, 'ok.svg'))).toBe(SVG);
  expect(readSvgIcon(join(dir, 'prolog.svg'))).toContain('<svg');
  expect(readSvgIcon(join(dir, 'big.svg'))).toBeNull();
  expect(readSvgIcon(join(dir, 'png.svg'))).toBeNull();
  expect(readSvgIcon(join(dir, 'missing.svg'))).toBeNull();
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `bun test --cwd apps/deck src/registry/manifest.test.ts`
Expected: FAIL with `SyntaxError: Export named 'readSvgIcon' not found`.

- [ ] **Step 4: Implement**

In `apps/deck/src/registry/manifest.ts`, add after `looksLikeSvg` (line 53):

```ts
/** The svg text at `path` when it is svg-rooted and at most 64 KB, else null. */
export function readSvgIcon(path: string): string | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return null;
  }
  if (bytes.byteLength > MAX_ICON_BYTES) return null;
  const svg = bytes.toString('utf8');
  return looksLikeSvg(svg) ? svg : null;
}
```

and replace the icon read in `ingestManifest` (lines 114-123, from `let svg: string;` through `if (!looksLikeSvg(svg)) return;`) with:

```ts
  const svg = readSvgIcon(resolve(appDir, manifest.icon));
  if (svg === null) return;
```

- [ ] **Step 5: Run them and see them pass**

Run: `bun test --cwd apps/deck src/services/bundle-layout.test.ts src/registry/manifest.test.ts`
Expected: PASS, every test in both files (the existing `ingestManifest` tests prove the refactor kept behavior; `bundle-layout.test.ts` is B's and still passes).

Run: `bunx tsc --noEmit -p apps/deck/tsconfig.json > <scratchpad>/tsc-c.txt 2>&1`, then `grep -E 'registry/manifest\.ts' <scratchpad>/tsc-c.txt`
Expected: no output.

Run: `bunx prettier --write apps/deck/src/registry/manifest.ts apps/deck/src/registry/manifest.test.ts`, then `bunx prettier --check apps/deck/src/registry/manifest.ts apps/deck/src/registry/manifest.test.ts`
Expected: `All matched files use Prettier code style!`.

- [ ] **Step 6: Commit**

```bash
git add apps/deck/src/registry/manifest.ts apps/deck/src/registry/manifest.test.ts
git commit -m "deck: a shared readSvgIcon check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Read a bundled app's identity

**Files:**
- Create: `apps/deck/src/registry/bundled-identity.ts`
- Create: `apps/deck/src/registry/bundled-identity.test.ts`
- Create: `apps/deck/src/registry/__fixtures__/bundle-resources/apps/board/mattstack.deck.json`
- Create: `apps/deck/src/registry/__fixtures__/bundle-resources/apps/board/src/favicon.svg`

**Interfaces:**
- Consumes: `readDeckManifest(dir): ParseResult` (`registry/deck-manifest.ts:34-179`; requires `name` to match `NAME_RE`, keeps `badge` only when it starts with `/` and not `//`), `readSvgIcon(path)` (Task 1).
- Produces:
  - `export interface AppIdentity { displayName: string; description?: string; badge?: string; iconFile: string | null }`
  - `export function readBundledIdentity(resourcesDir: string, name: string): (AppIdentity & { iconFile: string }) | null`, reading `<resourcesDir>/apps/<name>/mattstack.deck.json`.

- [ ] **Step 1: Write the twin fixture files**

These two files must be byte-identical to repo-tools' `scripts/lib/__tests__/fixtures/bundle-resources/apps/board/` (Task 8). Write them with exactly this content, each ending in a single newline.

`apps/deck/src/registry/__fixtures__/bundle-resources/apps/board/mattstack.deck.json`:

```json
{
  "name": "board",
  "displayName": "Board",
  "description": "Open MRs ready for review.",
  "icon": "./src/favicon.svg",
  "badge": "/api/badge"
}
```

`apps/deck/src/registry/__fixtures__/bundle-resources/apps/board/src/favicon.svg`:

```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>
```

- [ ] **Step 2: Write the failing test**

`apps/deck/src/registry/bundled-identity.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { expect, test } from 'bun:test';

import { readBundledIdentity } from './bundled-identity.ts';

// Parity anchor: repo-tools scripts/lib/__tests__/fixtures/bundle-resources/
// holds byte-identical files, and its staging test proves bundle-apps writes
// exactly these bytes into every app tarball.
const FIXTURE_RESOURCES = join(
  import.meta.dir,
  '__fixtures__',
  'bundle-resources'
);
const BOARD_ICON = join(FIXTURE_RESOURCES, 'apps', 'board', 'src', 'favicon.svg');

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>';

function resources(
  name: string,
  manifest: object,
  files: Record<string, string>
): string {
  const root = mkdtempSync(join(tmpdir(), 'bundle-resources-'));
  const dir = join(root, 'apps', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mattstack.deck.json'), JSON.stringify(manifest));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

test('reads the staged identity bundle-apps ships', () => {
  expect(readBundledIdentity(FIXTURE_RESOURCES, 'board')).toEqual({
    displayName: 'Board',
    description: 'Open MRs ready for review.',
    badge: '/api/badge',
    iconFile: BOARD_ICON,
  });
});

test('an app with no identity dir has none', () => {
  expect(readBundledIdentity(FIXTURE_RESOURCES, 'chat')).toBeNull();
});

test('a manifest naming a different app is ignored', () => {
  const root = resources(
    'board',
    { name: 'chat', displayName: 'Chat', icon: './i.svg' },
    { 'i.svg': SVG }
  );
  expect(readBundledIdentity(root, 'board')).toBeNull();
});

test('a manifest without displayName or icon is no identity', () => {
  const root = resources(
    'board',
    { name: 'board', icon: './i.svg' },
    { 'i.svg': SVG }
  );
  expect(readBundledIdentity(root, 'board')).toBeNull();
});

test('an icon path that escapes the identity dir is refused', () => {
  const up = resources(
    'board',
    { name: 'board', displayName: 'Board', icon: '../../escape.svg' },
    { '../../escape.svg': SVG }
  );
  expect(readBundledIdentity(up, 'board')).toBeNull();
  const abs = resources(
    'board',
    { name: 'board', displayName: 'Board', icon: join(up, 'escape.svg') },
    {}
  );
  expect(readBundledIdentity(abs, 'board')).toBeNull();
});

test('an oversize or non-svg bundled icon yields no identity', () => {
  const big = resources(
    'board',
    { name: 'board', displayName: 'Board', icon: './i.svg' },
    { 'i.svg': `<svg>${' '.repeat(64 * 1024)}</svg>` }
  );
  expect(readBundledIdentity(big, 'board')).toBeNull();
  const png = resources(
    'board',
    { name: 'board', displayName: 'Board', icon: './i.svg' },
    { 'i.svg': 'PNG' }
  );
  expect(readBundledIdentity(png, 'board')).toBeNull();
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `bun test --cwd apps/deck src/registry/bundled-identity.test.ts`
Expected: FAIL with `Cannot find module './bundled-identity.ts'`.

- [ ] **Step 4: Implement**

`apps/deck/src/registry/bundled-identity.ts`:

```ts
import { isAbsolute, join, relative, resolve } from 'path';

import { readDeckManifest } from './deck-manifest.ts';
import { readSvgIcon } from './manifest.ts';

export interface AppIdentity {
  displayName: string;
  description?: string;
  badge?: string;
  /** The svg served at /api/apps/<name>/icon; null when the row advertises no icon. */
  iconFile: string | null;
}

/**
 * The identity repo-tools' build.sh lands at Contents/Resources/apps/<name>/
 * for a served app. Null when the dir is absent or anything in it fails the
 * checks ingestManifest applies to a checkout: the icon must stay inside the
 * dir, be svg-rooted and be at most 64 KB.
 */
export function readBundledIdentity(
  resourcesDir: string,
  name: string
): (AppIdentity & { iconFile: string }) | null {
  const dir = join(resourcesDir, 'apps', name);
  const parsed = readDeckManifest(dir);
  if (!parsed || !parsed.ok) return null;
  const m = parsed.manifest;
  if (m.name !== name || !m.displayName || !m.icon) return null;
  const iconFile = resolve(dir, m.icon);
  const rel = relative(dir, iconFile);
  if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    return null;
  if (readSvgIcon(iconFile) === null) return null;
  return {
    displayName: m.displayName,
    ...(m.description !== undefined ? { description: m.description } : {}),
    ...(m.badge !== undefined ? { badge: m.badge } : {}),
    iconFile,
  };
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `bun test --cwd apps/deck src/registry/bundled-identity.test.ts`
Expected: PASS, 6 tests.

Run: `bunx tsc --noEmit -p apps/deck/tsconfig.json > <scratchpad>/tsc-c.txt 2>&1`, then `grep -E 'bundled-identity' <scratchpad>/tsc-c.txt`
Expected: no output.

Run: `bunx prettier --check apps/deck/src/registry/bundled-identity.ts apps/deck/src/registry/bundled-identity.test.ts apps/deck/src/registry/__fixtures__/bundle-resources/apps/board/mattstack.deck.json`
Expected: all files pass. If prettier rewrites the fixture JSON, stop: the fixture's bytes are a contract with repo-tools, so fix the fixture text (2-space indent, one trailing newline) until prettier accepts it unchanged, and use the same bytes in Task 8.

- [ ] **Step 6: Commit**

```bash
git add apps/deck/src/registry/bundled-identity.ts apps/deck/src/registry/bundled-identity.test.ts apps/deck/src/registry/__fixtures__
git commit -m "deck: read a served app's identity from the bundle's Resources/apps" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Effective identity and its precedence

**Files:**
- Modify: `apps/deck/src/registry/bundled-identity.ts`
- Modify: `apps/deck/src/registry/bundled-identity.test.ts`

**Interfaces:**
- Consumes: `bundleResourcesDir()` (unit B, `services/bundle-layout.ts`), `iconPathFor(name)` (`registry/manifest.ts:59-61`), `isPlatformManagedBy(managedBy)` (`services/manager.ts:19-21`), `AppRecord` (`registry/records.ts:29-66`).
- Produces:
  - `export function setBundledResourcesDir(dir: string | null | undefined): void` (test seam; `undefined` restores the running bundle's dir).
  - `export function effectiveIdentity(record: AppRecord, resourcesDir?: string | null): AppIdentity` (default `resourcesDir` is the seam's value, else `bundleResourcesDir()`).
  - `export function statusIconUrl(record: AppRecord): string | null` (`'/favicon.svg'` for the platform row, `/api/apps/<name>/icon` when the effective identity has an icon, else null).

Precedence, in order: a `user` or platform row uses its stored fields; a row with `dev.workingDirectory` AND a stored `displayName` uses its stored fields (ingested from the checkout); otherwise the bundled identity when one reads cleanly; otherwise the stored fields. Stored fields are `displayName ?? name`, `description`, `badge`, and `iconFile = record.icon ? iconPathFor(name) : null`.

- [ ] **Step 1: Write the failing tests**

In `bundled-identity.test.ts`, change the import to:

```ts
import {
  effectiveIdentity,
  readBundledIdentity,
  statusIconUrl,
  setBundledResourcesDir,
} from './bundled-identity.ts';
import { iconPathFor } from './manifest.ts';
import type { AppRecord } from './records.ts';
```

add `afterEach` to the `bun:test` import, and append:

```ts
function record(over: Partial<AppRecord> = {}): AppRecord {
  return {
    name: 'board',
    managedBy: 'rt',
    port: 11006,
    kind: 'service',
    createdAt: '2026-09-24T00:00:00Z',
    ...over,
  };
}

afterEach(() => setBundledResourcesDir(undefined));

test('an unlinked managed row takes its identity from the bundle', () => {
  expect(effectiveIdentity(record(), FIXTURE_RESOURCES)).toEqual({
    displayName: 'Board',
    description: 'Open MRs ready for review.',
    badge: '/api/badge',
    iconFile: BOARD_ICON,
  });
});

test('bundled identity replaces a stale stored identity on an unlinked row', () => {
  const id = effectiveIdentity(
    record({ displayName: 'Old', icon: { ext: 'svg' } }),
    FIXTURE_RESOURCES
  );
  expect(id.displayName).toBe('Board');
  expect(id.iconFile).toBe(BOARD_ICON);
});

test('a linked row with an ingested identity keeps it', () => {
  const id = effectiveIdentity(
    record({
      dev: { workingDirectory: '/src/board' },
      displayName: 'Board (source)',
      icon: { ext: 'svg' },
    }),
    FIXTURE_RESOURCES
  );
  expect(id.displayName).toBe('Board (source)');
  expect(id.iconFile).toBe(iconPathFor('board'));
});

test('a linked row that never ingested an identity falls back to the bundle', () => {
  const id = effectiveIdentity(
    record({ dev: { workingDirectory: '/src/board' } }),
    FIXTURE_RESOURCES
  );
  expect(id.displayName).toBe('Board');
});

test('user and platform rows never read the bundle', () => {
  expect(
    effectiveIdentity(record({ managedBy: 'user' }), FIXTURE_RESOURCES)
  ).toEqual({ displayName: 'board', iconFile: null });
  expect(
    effectiveIdentity(record({ managedBy: 'deck' }), FIXTURE_RESOURCES)
  ).toEqual({ displayName: 'board', iconFile: null });
});

test('outside a bundle the stored fields are the identity', () => {
  expect(effectiveIdentity(record(), null)).toEqual({
    displayName: 'board',
    iconFile: null,
  });
});

test('statusIconUrl follows the effective identity through the seam', () => {
  setBundledResourcesDir(FIXTURE_RESOURCES);
  expect(statusIconUrl(record())).toBe('/api/apps/board/icon');
  expect(statusIconUrl(record({ managedBy: 'deck' }))).toBe('/favicon.svg');
  setBundledResourcesDir(null);
  expect(statusIconUrl(record())).toBeNull();
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun test --cwd apps/deck src/registry/bundled-identity.test.ts`
Expected: FAIL with `Export named 'effectiveIdentity' not found`.

- [ ] **Step 3: Implement**

In `bundled-identity.ts`, add imports:

```ts
import { bundleResourcesDir } from '../services/bundle-layout.ts';
import { isPlatformManagedBy } from '../services/manager.ts';
import { iconPathFor, readSvgIcon } from './manifest.ts';
import type { AppRecord } from './records.ts';
```

(replacing the single `readSvgIcon` import), and append:

```ts
let resourcesOverride: string | null | undefined;

/** Test seam: pins the Resources dir identity is read from; undefined restores the running bundle's. */
export function setBundledResourcesDir(dir: string | null | undefined): void {
  resourcesOverride = dir;
}

function currentResourcesDir(): string | null {
  return resourcesOverride !== undefined
    ? resourcesOverride
    : bundleResourcesDir();
}

function storedIdentity(record: AppRecord): AppIdentity {
  return {
    displayName: record.displayName ?? record.name,
    ...(record.description !== undefined
      ? { description: record.description }
      : {}),
    ...(record.badge ? { badge: record.badge } : {}),
    iconFile: record.icon ? iconPathFor(record.name) : null,
  };
}

export function effectiveIdentity(
  record: AppRecord,
  resourcesDir: string | null = currentResourcesDir()
): AppIdentity {
  const stored = storedIdentity(record);
  if (record.managedBy === 'user' || isPlatformManagedBy(record.managedBy))
    return stored;
  // A linked checkout's identity was ingested from source, which is newer
  // than the copy the bundle was built with.
  if (record.dev?.workingDirectory && record.displayName !== undefined)
    return stored;
  const bundled = resourcesDir
    ? readBundledIdentity(resourcesDir, record.name)
    : null;
  return bundled ?? stored;
}

/** The icon URL a status row carries, relative to deck's own origin. */
export function statusIconUrl(record: AppRecord): string | null {
  if (isPlatformManagedBy(record.managedBy)) return '/favicon.svg';
  return effectiveIdentity(record).iconFile
    ? `/api/apps/${record.name}/icon`
    : null;
}
```

- [ ] **Step 4: Run them and see them pass**

Run: `bun test --cwd apps/deck src/registry/bundled-identity.test.ts`
Expected: PASS, 13 tests.

Run: `bunx tsc --noEmit -p apps/deck/tsconfig.json > <scratchpad>/tsc-c.txt 2>&1`, then `grep -E 'bundled-identity' <scratchpad>/tsc-c.txt`
Expected: no output.

Run: `bunx prettier --check apps/deck/src/registry/bundled-identity.ts apps/deck/src/registry/bundled-identity.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/registry/bundled-identity.ts apps/deck/src/registry/bundled-identity.test.ts
git commit -m "deck: effective identity prefers a linked checkout, then the bundle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: /api/apps and the icon route read the effective identity

**Files:**
- Modify: `apps/deck/src/api/discovery.ts` (loop body lines 36-43; `iconResponse` lines 52-62)
- Modify: `apps/deck/src/api/discovery.test.ts`

**Interfaces:**
- Consumes: `effectiveIdentity(record)` (Task 3), `getRecord(name)` (`registry/records.ts:123-125`), `iconPathFor(name)`.
- Produces: unchanged signatures `buildDiscoveryApps(opts): Promise<DiscoveryApp[]>` and `iconResponse(name: string): Response`; `DiscoveryApp` keeps its shape (`discovery.ts:8-17`).

Unit B may add a not-served filter to this same loop. Keep B's guard (a `continue` before the push) where B puts it; this task only changes the fields inside `apps.push({...})`.

- [ ] **Step 1: Write the failing tests**

In `apps/deck/src/api/discovery.test.ts`, after the existing `ingestManifest` import (line 20), add:

```ts
const { setBundledResourcesDir } = await import(
  '../registry/bundled-identity.ts'
);
const FIXTURE_RESOURCES = join(
  import.meta.dir,
  '..',
  'registry',
  '__fixtures__',
  'bundle-resources'
);
```

Add `readFileSync` to the `fs` import on line 1. In the existing `beforeEach` (lines 38-43) add `setBundledResourcesDir(null);` as its first line. Then add, before the `// ---- GET /api/apps ... over HTTP ----` block:

```ts
function boardRow(extra: Record<string, unknown> = {}): void {
  putRecord({
    name: 'board',
    managedBy: 'rt',
    port: 11006,
    kind: 'service',
    createdAt: '2026-09-24T00:00:00Z',
    ...extra,
  });
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: 'board.localhost', port: 11006 }])
  );
}

test('an unlinked catalog row takes name, description, badge and icon from the bundle', async () => {
  boardRow();
  setBundledResourcesDir(FIXTURE_RESOURCES);
  const board = (await buildDiscoveryApps(statusOpts)).find(
    a => a.name === 'board'
  )!;
  expect(board.displayName).toBe('Board');
  expect(board.description).toBe('Open MRs ready for review.');
  expect(board.badge).toBe('/api/badge');
  expect(board.icon).toBe('board');
});

test('iconResponse serves the bundled svg for an unlinked catalog row', async () => {
  boardRow();
  setBundledResourcesDir(FIXTURE_RESOURCES);
  const res = iconResponse('board');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/svg+xml');
  expect(await res.text()).toBe(
    readFileSync(
      join(FIXTURE_RESOURCES, 'apps', 'board', 'src', 'favicon.svg'),
      'utf8'
    )
  );
});

test('a linked row keeps the identity ingested from its checkout', async () => {
  const src = mkdtempSync(join(tmpdir(), 'discovery-linked-'));
  writeFileSync(
    join(src, 'mattstack.deck.json'),
    JSON.stringify({
      name: 'board',
      displayName: 'Board (source)',
      icon: './icon.svg',
    })
  );
  writeFileSync(join(src, 'icon.svg'), SVG);
  boardRow({ dev: { workingDirectory: src } });
  ingestManifest('board');
  setBundledResourcesDir(FIXTURE_RESOURCES);
  const board = (await buildDiscoveryApps(statusOpts)).find(
    a => a.name === 'board'
  )!;
  expect(board.displayName).toBe('Board (source)');
  expect(await iconResponse('board').text()).toBe(SVG);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun test --cwd apps/deck src/api/discovery.test.ts`
Expected: FAIL on the first two new tests (`expected "Board", received "board"`; icon route `expected 200, received 404`). The third passes already; it pins that the change keeps linked rows as they are.

- [ ] **Step 3: Implement**

In `apps/deck/src/api/discovery.ts`:

- imports become:

```ts
import { existsSync } from 'fs';

import { effectiveIdentity } from '../registry/bundled-identity.ts';
import { iconPathFor } from '../registry/manifest.ts';
import { getRecord, listRecords } from '../registry/records.ts';
import { isPlatformManagedBy } from '../services/manager.ts';
import { buildStatus, type BuildStatusOpts } from './status.ts';
```

- the push (lines 36-43) becomes:

```ts
    const identity = effectiveIdentity(record);
    apps.push({
      name: record.name,
      displayName: identity.displayName,
      description: identity.description,
      url,
      icon: identity.iconFile ? record.name : null,
      ...(identity.badge ? { badge: identity.badge } : {}),
    });
```

- `iconResponse` becomes:

```ts
/** Serves the svg the app's effective identity names, 404 when there is none. */
export function iconResponse(name: string): Response {
  const record = getRecord(name);
  const p = (record ? effectiveIdentity(record).iconFile : null) ?? iconPathFor(name);
  if (!existsSync(p)) return new Response('not found', { status: 404 });
  return new Response(Bun.file(p), {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=300',
    },
  });
}
```

- [ ] **Step 4: Run them and see them pass**

Run: `bun test --cwd apps/deck src/api/discovery.test.ts src/api/discovery-e2e.test.ts src/registry/bundled-identity.test.ts`
Expected: PASS, every test (the existing HTTP tests at the bottom of `discovery.test.ts` and `discovery-e2e.test.ts` prove the route shape is unchanged).

Run: `bunx tsc --noEmit -p apps/deck/tsconfig.json > <scratchpad>/tsc-c.txt 2>&1`, then `grep -E 'api/discovery' <scratchpad>/tsc-c.txt`
Expected: no output.

Run: `bunx prettier --check apps/deck/src/api/discovery.ts apps/deck/src/api/discovery.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/api/discovery.ts apps/deck/src/api/discovery.test.ts
git commit -m "deck: /api/apps and the icon route serve bundled identity for unlinked rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Status rows advertise the bundled icon

**Files:**
- Modify: `apps/deck/src/api/status.ts` (row `icon`, lines 214-221)
- Modify: `apps/deck/src/api/status.test.ts`
- Modify: `apps/deck/src/api/server.ts` (`rowFor` `icon`, lines 272-276)
- Modify: `apps/deck/src/api/server.test.ts`

**Interfaces:**
- Consumes: `statusIconUrl(record)` (Task 3), `setBundledResourcesDir` (Task 3).
- Produces: no new exports. `StatusRow.icon` (`status.ts:57-118`) keeps its type; both status row builders now share one icon rule instead of two copies of the same ternary.

- [ ] **Step 1: Write the failing tests**

In `apps/deck/src/api/status.test.ts`, add `mkdirSync` to the `fs` import and `afterEach` to the `bun:test` import, then after the `putRecord`/`reloadRegistry` import (line 22) add:

```ts
const { setBundledResourcesDir } = await import(
  '../registry/bundled-identity.ts'
);

function bundleResources(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'status-resources-'));
  const dir = join(root, 'apps', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'mattstack.deck.json'),
    JSON.stringify({ name, displayName: 'My App', icon: './icon.svg' })
  );
  writeFileSync(
    join(dir, 'icon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  );
  return root;
}

afterEach(() => setBundledResourcesDir(undefined));

test('a managed row with only a bundled identity carries its icon URL', async () => {
  putRecord({
    name: 'myapp',
    managedBy: 'rt',
    port: 19999,
    kind: 'service',
    createdAt: '2026-09-24T00:00:00Z',
  });
  setBundledResourcesDir(bundleResources('myapp'));
  const row = (await buildStatus(opts)).apps.find(a => a.name === 'myapp')!;
  expect(row.icon).toBe('/api/apps/myapp/icon');
  setBundledResourcesDir(null);
  const bare = (await buildStatus(opts)).apps.find(a => a.name === 'myapp')!;
  expect(bare.icon).toBeNull();
});
```

In `apps/deck/src/api/server.test.ts`, reuse the file's existing `api()` helper and its registry imports (add `putRecord`/`deleteRecord` from `../registry/records.ts` only if the file does not import them yet), and append:

```ts
test('a record with no route yet carries its bundled icon URL', async () => {
  const { setBundledResourcesDir } = await import(
    '../registry/bundled-identity.ts'
  );
  const root = mkdtempSync(join(tmpdir(), 'server-resources-'));
  const dir = join(root, 'apps', 'bundled-only');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'mattstack.deck.json'),
    JSON.stringify({
      name: 'bundled-only',
      displayName: 'Bundled',
      icon: './icon.svg',
    })
  );
  writeFileSync(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  putRecord({
    name: 'bundled-only',
    managedBy: 'rt',
    port: 11999,
    kind: 'service',
    createdAt: '2026-09-24T00:00:00Z',
  });
  setBundledResourcesDir(root);
  try {
    const list = await (await api('/api/v1/apps')).json();
    const row = list.apps.find((a: any) => a.name === 'bundled-only');
    expect(row.icon).toBe('/api/apps/bundled-only/icon');
  } finally {
    setBundledResourcesDir(undefined);
    deleteRecord('bundled-only');
  }
});
```

(Add `mkdirSync`, `mkdtempSync`, `tmpdir` and `join` to that file's imports if they are not already there.)

- [ ] **Step 2: Run them and see them fail**

Run: `bun test --cwd apps/deck src/api/status.test.ts src/api/server.test.ts -t "bundled"`
Expected: FAIL on both new tests: `expected "/api/apps/myapp/icon", received null` and `expected "/api/apps/bundled-only/icon", received null`.

- [ ] **Step 3: Implement**

In `apps/deck/src/api/status.ts`, add `import { statusIconUrl } from '../registry/bundled-identity.ts';` and replace the row's `icon:` property (lines 214-221) with:

```ts
        icon: record ? statusIconUrl(record) : null,
```

In `apps/deck/src/api/server.ts`, add `import { statusIconUrl } from '../registry/bundled-identity.ts';` and replace `rowFor`'s `icon:` property (lines 272-276) with:

```ts
      icon: statusIconUrl(record),
```

Remove `isPlatformManagedBy` from either file's imports only if the compiler reports it unused (both files use it elsewhere today).

- [ ] **Step 4: Run them and see them pass**

Run: `bun test --cwd apps/deck src/api/status.test.ts src/api/server.test.ts src/api/discovery.test.ts`
Expected: PASS, every test in all three files.

Run: `bunx tsc --noEmit -p apps/deck/tsconfig.json > <scratchpad>/tsc-c.txt 2>&1`, then `grep -E 'api/(status|server)\.ts' <scratchpad>/tsc-c.txt`
Expected: no output.

Run: `bunx prettier --check apps/deck/src/api/status.ts apps/deck/src/api/status.test.ts apps/deck/src/api/server.ts apps/deck/src/api/server.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/api/status.ts apps/deck/src/api/status.test.ts apps/deck/src/api/server.ts apps/deck/src/api/server.test.ts
git commit -m "deck: status rows take their icon from the effective identity" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Document it and bump the three apps for re-release

**Files:**
- Modify: `apps/deck/docs/manifest.md` ("App launcher registry", lines 59-78)
- Modify: `apps/board/package.json` (`0.1.5` to `0.1.6`), `apps/chat/package.json` (`0.1.2` to `0.1.3`), `apps/console/package.json` (`0.1.2` to `0.1.3`), `bun.lock`

**Interfaces:** none (docs and versions).

- [ ] **Step 1: Docs**

Append to the "App launcher registry" section of `apps/deck/docs/manifest.md`, after the `GET /api/apps/:name/icon` sentence:

```markdown
Inside the mattstack app, a managed app with no linked checkout takes its
identity from the bundle instead: repo-tools' app build ships an
identity-only `mattstack.deck.json` (name, displayName, description, icon,
badge) and the icon it names at `Contents/Resources/apps/<name>/`, for each
app the bundle serves. A linked checkout's ingested identity wins over the
bundle's copy. Deck reads the bundled copy per request and never writes it to
the registry, so both flavors' decks read one registry unchanged.
`/api/apps`, the icon route and the board's status rows all read the same
effective identity.
```

- [ ] **Step 2: Version bumps**

Edit the `"version"` line in each of `apps/board/package.json` (to `"0.1.6"`), `apps/chat/package.json` (to `"0.1.3"`) and `apps/console/package.json` (to `"0.1.3"`), then refresh the lockfile's workspace versions:

Run: `bun install`, then `git diff --stat`
Expected: exactly `apps/board/package.json`, `apps/chat/package.json`, `apps/console/package.json`, `bun.lock` and `apps/deck/docs/manifest.md` changed. If unit D has merged its own change to `bun.lock` since you branched, rebase first (`git fetch origin`, then `git rebase origin/main`) and rerun `bun install` so `bun.lock` carries every bump.

Run: `bun install --frozen-lockfile`
Expected: exits 0 (the lockfile is consistent, which is what CI's `bun install && git diff --exit-code -- bun.lock` checks).

- [ ] **Step 3: Format and commit**

`apps/deck/docs` and `bun.lock` are prettier-ignored; the three `package.json` files are not.

```bash
bunx prettier --write apps/board/package.json apps/chat/package.json apps/console/package.json
bunx prettier --check apps/board/package.json apps/chat/package.json apps/console/package.json
git add apps/deck/docs/manifest.md apps/board/package.json apps/chat/package.json apps/console/package.json bun.lock
git commit -m "board 0.1.6, chat 0.1.3, console 0.1.3; document bundled identity" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Push and open PR C-apps

- [ ] **Step 1: Final targeted check**

Run: `bun test --cwd apps/deck src/registry/bundled-identity.test.ts src/registry/manifest.test.ts src/services/bundle-layout.test.ts src/api/discovery.test.ts src/api/discovery-e2e.test.ts src/api/status.test.ts src/api/server.test.ts`
Expected: PASS.

Run: `bun run format:check`
Expected: exits 0 (the root-level check CI's `checks` job runs).

Run: `git diff origin/main -U0 > <scratchpad>/c-apps-diff.txt`, then `perl -CSD -ne 'print if /^\+.*[\x{2013}\x{2014}]/' <scratchpad>/c-apps-diff.txt`
Expected: the second command prints nothing (no em or en dashes added).

- [ ] **Step 2: Push**

```bash
git push -u origin apps-2-13-c-bundle-identity
```

- [ ] **Step 3: Write the PR body** with the Write tool to `<scratchpad>/pr-body-c-apps.md`:

```markdown
Prod tabs had no names or icons on a clean install: deck only ever ingested identity from a linked checkout, and a clean install links none.

### What changed

**Deck** (`apps/deck`)

- Adds `registry/bundled-identity.ts`: reads `Contents/Resources/apps/<name>/` and resolves a row's effective identity.
- A linked checkout's ingested identity still wins; an unlinked row reads the bundle's copy.
- `/api/apps`, `/api/apps/:name/icon`, `/api/v1/status` and `/api/v1/apps` read through it.
- Nothing is written to the registry, so the older deck in the other flavor is unaffected.
- Adds a shared `readSvgIcon()`; the Resources dir comes from deck 1.1.0's `bundleResourcesDir()`.

**Also**

- board 0.1.6, chat 0.1.3, console 0.1.3 so bundle-apps can re-release them with identity in the tarball.

### Release order

- Builds on the deck 1.1.0 sweep PR, already merged.
- The repo-tools half (bundle-apps stages identity, build.sh lands it) must merge before the 2.13.0 bundle-apps dispatch.
- That dispatch lists deck, boxscore, board, chat and console.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --repo m4ttstack/apps --base main --head apps-2-13-c-bundle-identity --title "deck: serve bundled app identity for unlinked rows (2.13.0 unit C)" --body-file <scratchpad>/pr-body-c-apps.md
```

Expected: the PR URL prints.

---

## PR C-rt (m4ttstack/rt, repo-tools)

### Task 8: Identity validation, the staged form and staging

**Files:**
- Create: `scripts/lib/app-identity.ts`
- Create: `scripts/lib/__tests__/app-identity.test.ts`
- Create: `scripts/lib/__tests__/fixtures/bundle-resources/apps/board/mattstack.deck.json`
- Create: `scripts/lib/__tests__/fixtures/bundle-resources/apps/board/src/favicon.svg`

**Interfaces:**
- Consumes: nothing at runtime beyond `fs` and `path` (this module is imported by the bundle-apps build job, which never runs `bun install` for repo-tools; see `bundle-apps.yml:57-62` and `:87-95`).
- Produces:
  - `export const IDENTITY_MANIFEST = "mattstack.deck.json"`
  - `export interface AppIdentity { name: string; displayName: string; description?: string; icon: string; badge?: string }`
  - `export function iconSegments(icon: string): string[]` (throws on absolute, `..`, empty or dotted-directory paths)
  - `export function isSvgIcon(path: string): boolean`
  - `export function readDeclaredIdentity(dir: string): AppIdentity | null` (null when the manifest declares no `displayName` or no `icon`; throws when it declares both but anything is invalid)
  - `export function serializeIdentity(id: AppIdentity): string` (deterministic: keys in the order name, displayName, description, icon, badge; 2-space JSON; one trailing newline)
  - `export function stageIdentity(appDir: string, outDir: string, expectedName?: string): AppIdentity | null`

- [ ] **Step 1: Enter the worktree**

Use EnterWorktree name-mode with name `rt-2-13-c-bundle-identity`. Inside it, one command per Bash call:

```bash
git fetch origin main
git switch -c rt-2-13-c-bundle-identity origin/main
bun install --frozen-lockfile
grep -n "serve?:" lib/bundle-layout.ts
```

Expected: on branch `rt-2-13-c-bundle-identity` at `origin/main`, and the grep prints unit A's `serve?: DepsLockServe;` on `DepsLockTool`. If the grep prints nothing, A has not merged: stop and report, since Task 11 reads `t.serve` directly. (If the provisioned tree already sits on a branch of that name, run `git reset --hard origin/main` on it instead of the switch, since it holds no work yet.)

All later C-rt commands run from the worktree root.

- [ ] **Step 2: Write the twin fixture files**

Byte-identical to Task 2's deck fixture. `scripts/lib/__tests__/fixtures/bundle-resources/apps/board/mattstack.deck.json`:

```json
{
  "name": "board",
  "displayName": "Board",
  "description": "Open MRs ready for review.",
  "icon": "./src/favicon.svg",
  "badge": "/api/badge"
}
```

`scripts/lib/__tests__/fixtures/bundle-resources/apps/board/src/favicon.svg`:

```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>
```

Each file ends in exactly one newline.

- [ ] **Step 3: Write the failing test**

`scripts/lib/__tests__/app-identity.test.ts`:

```ts
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { iconSegments, readDeclaredIdentity, serializeIdentity, stageIdentity } from "../app-identity.ts";

// Parity anchor: m4ttstack/apps apps/deck/src/registry/__fixtures__/bundle-resources/
// holds byte-identical files, and deck's bundled-identity test proves deck
// reads exactly these bytes as board's identity.
const FIXTURE = join(import.meta.dir, "fixtures", "bundle-resources", "apps", "board");
const SVG = readFileSync(join(FIXTURE, "src", "favicon.svg"), "utf8");

function appDir(manifest: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "app-identity-"));
  writeFileSync(join(dir, "mattstack.deck.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}

const BOARD_SOURCE = {
  name: "board",
  displayName: "Board",
  description: "Open MRs ready for review.",
  icon: "./src/favicon.svg",
  port: 11006,
  includeInBundle: true,
  badge: "/api/badge",
  dev: { start: "bun src/server.ts" },
  bundle: { build: "bun run build", artifact: "dist/board" },
};

test("staging board's source manifest writes exactly the twin fixture's bytes", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-out-")), "identity");
  const id = stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": SVG }), out, "board");
  expect(id?.name).toBe("board");
  expect(readFileSync(join(out, "mattstack.deck.json"), "utf8")).toBe(readFileSync(join(FIXTURE, "mattstack.deck.json"), "utf8"));
  expect(readFileSync(join(out, "src", "favicon.svg"), "utf8")).toBe(SVG);
});

test("the fixture is already in the staged form", () => {
  const id = readDeclaredIdentity(FIXTURE)!;
  expect(serializeIdentity(id)).toBe(readFileSync(join(FIXTURE, "mattstack.deck.json"), "utf8"));
});

test("a manifest without displayName or icon stages nothing and clears a stale out dir", () => {
  const out = mkdtempSync(join(tmpdir(), "stage-stale-"));
  writeFileSync(join(out, "leftover"), "x");
  expect(stageIdentity(appDir({ name: "deck", bundle: { build: "b", artifact: "dist/deck" } }), out)).toBeNull();
  expect(existsSync(out)).toBe(false);
});

test("a manifest naming another app fails staging", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-name-")), "identity");
  expect(() => stageIdentity(appDir({ ...BOARD_SOURCE, name: "chat" }, { "src/favicon.svg": SVG }), out, "board")).toThrow(/does not match board/);
});

test("icon paths that escape, are absolute, or cross a dotted dir are refused", () => {
  expect(() => iconSegments("../x.svg")).toThrow(/\.\./);
  expect(() => iconSegments("./a/../../x.svg")).toThrow(/\.\./);
  expect(() => iconSegments("/etc/x.svg")).toThrow(/relative/);
  expect(() => iconSegments("./")).toThrow(/names no file/);
  expect(() => iconSegments("./my.assets/x.svg")).toThrow(/dot/);
  expect(iconSegments("./src/favicon.svg")).toEqual(["src", "favicon.svg"]);
});

test("a declared icon that is missing, oversize or not svg fails staging", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-icon-")), "identity");
  expect(() => stageIdentity(appDir(BOARD_SOURCE), out)).toThrow(/icon .* is missing, over 64 KB, or not an svg/);
  expect(() => stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": `<svg>${" ".repeat(64 * 1024)}</svg>` }), out)).toThrow(/over 64 KB/);
  expect(() => stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": "PNG" }), out)).toThrow(/not an svg/);
});

test("a badge off the app's own origin fails staging", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-badge-")), "identity");
  expect(() => stageIdentity(appDir({ ...BOARD_SOURCE, badge: "//evil.example/b" }, { "src/favicon.svg": SVG }), out)).toThrow(/badge/);
});

test("a name deck would reject fails staging", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-badname-")), "identity");
  expect(() => stageIdentity(appDir({ ...BOARD_SOURCE, name: "Board" }, { "src/favicon.svg": SVG }), out)).toThrow(/name must match/);
});
```

- [ ] **Step 4: Run it and see it fail**

Run: `bun test scripts/lib/__tests__/app-identity.test.ts`
Expected: FAIL with `Cannot find module '../app-identity.ts'`.

- [ ] **Step 5: Implement**

`scripts/lib/app-identity.ts`:

```ts
// An app's launcher identity (name, icon, badge) as the mattstack.app bundle
// ships it at Contents/Resources/apps/<name>/: staged into each app tarball by
// bundle-apps, materialized by fetch-deps, landed by build.sh, asserted by
// check-bundle.sh. Imported by the bundle-apps build job, which never installs
// this repo's dependencies, so every runtime import stays in node builtins.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join } from "path";

export const IDENTITY_MANIFEST = "mattstack.deck.json";

// Parity anchor: m4ttstack/apps apps/deck/src/registry/manifest.ts
// (MAX_ICON_BYTES, SVG_ROOT) and deck-manifest.ts (NAME_RE, the badge rule).
// Deck silently drops an identity it refuses, so these rules move with deck's.
const MAX_ICON_BYTES = 64 * 1024;
const SVG_ROOT = /^\s*(?:<\?xml\b[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE\b[^>]*>\s*)*<svg[\s>]/i;
const NAME_RE = /^[a-z0-9][a-z0-9.-]*$/;

export interface AppIdentity {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  badge?: string;
}

/** The icon path's segments below the identity dir. */
export function iconSegments(icon: string): string[] {
  if (isAbsolute(icon)) throw new Error(`icon ${icon} must be relative to the app dir`);
  const segs = icon.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.includes("..")) throw new Error(`icon ${icon} must not contain ".." segments`);
  if (segs.length === 0) throw new Error(`icon ${icon} names no file`);
  // Same rule as skills dirs: a dotted directory inside the bundle can read to
  // codesign as a nested bundle.
  for (const dir of segs.slice(0, -1)) {
    if (dir.includes(".")) throw new Error(`icon ${icon}: directory ${dir} contains a dot`);
  }
  return segs;
}

export function isSvgIcon(path: string): boolean {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return false;
  }
  return bytes.byteLength <= MAX_ICON_BYTES && SVG_ROOT.test(bytes.toString("utf8"));
}

export function readDeclaredIdentity(dir: string): AppIdentity | null {
  const path = join(dir, IDENTITY_MANIFEST);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`no ${IDENTITY_MANIFEST} in ${dir}`);
    throw err;
  }
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: manifest must be a JSON object`);
  }
  const m = parsed as Record<string, unknown>;
  if (m.displayName === undefined || m.icon === undefined) return null;
  const { name, displayName, description, icon, badge } = m;
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error(`${path}: name must match ${NAME_RE}`);
  if (typeof displayName !== "string" || !displayName) throw new Error(`${path}: displayName must be a non-empty string`);
  if (typeof icon !== "string" || !icon) throw new Error(`${path}: icon must be a non-empty string`);
  if (description !== undefined && typeof description !== "string") throw new Error(`${path}: description must be a string`);
  if (badge !== undefined && (typeof badge !== "string" || !badge.startsWith("/") || badge.startsWith("//"))) {
    throw new Error(`${path}: badge must be a path on the app's own origin, like /api/badge`);
  }
  if (!isSvgIcon(join(dir, ...iconSegments(icon)))) {
    throw new Error(`${path}: icon ${icon} is missing, over 64 KB, or not an svg`);
  }
  return {
    name,
    displayName,
    ...(description !== undefined ? { description } : {}),
    icon,
    ...(badge !== undefined ? { badge } : {}),
  };
}

export function serializeIdentity(id: AppIdentity): string {
  const out: Record<string, string> = { name: id.name, displayName: id.displayName };
  if (id.description !== undefined) out.description = id.description;
  out.icon = id.icon;
  if (id.badge !== undefined) out.badge = id.badge;
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function writeIdentity(id: AppIdentity, iconSource: string, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, IDENTITY_MANIFEST), serializeIdentity(id));
  const dest = join(outDir, ...iconSegments(id.icon));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(iconSource, dest);
}

/** Writes appDir's identity to outDir in the staged form, or returns null (outDir removed) when it declares none. */
export function stageIdentity(appDir: string, outDir: string, expectedName?: string): AppIdentity | null {
  rmSync(outDir, { recursive: true, force: true });
  const id = readDeclaredIdentity(appDir);
  if (!id) return null;
  if (expectedName !== undefined && id.name !== expectedName) {
    throw new Error(`${appDir}: manifest name ${id.name} does not match ${expectedName}`);
  }
  writeIdentity(id, join(appDir, ...iconSegments(id.icon)), outDir);
  return id;
}
```

- [ ] **Step 6: Run it and see it pass**

Run: `bun test scripts/lib/__tests__/app-identity.test.ts`
Expected: PASS, 8 tests.

Run: `bunx tsc --noEmit 2>&1 | grep -E 'app-identity'`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/app-identity.ts scripts/lib/__tests__/app-identity.test.ts scripts/lib/__tests__/fixtures/bundle-resources
git commit -m "add scripts/lib/app-identity.ts: validate and stage an app's bundle identity" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: bundle-apps puts identity in every app tarball

**Files:**
- Create: `scripts/bundle-ci/stage-identity.ts`
- Create: `scripts/bundle-ci/__tests__/stage-identity.test.ts`
- Modify: `.github/workflows/bundle-apps.yml` (new step after "Read and validate bundle recipe", lines 87-118; the stage block in "Build, smoke and stage", lines 160-162)

**Interfaces:**
- Consumes: `stageIdentity(appDir, outDir, expectedName)` (Task 8).
- Produces: CLI `bun scripts/bundle-ci/stage-identity.ts <app-dir> <out-dir> <app-name>`; exit 0 printing `staged identity for <name>` or `no identity declared; nothing staged`; exit 1 with the reason on an invalid identity; exit 2 on usage. Tarball layout gains `./identity/mattstack.deck.json` and `./identity/<icon path>` beside `./<name>` and `./skills/`.

- [ ] **Step 1: Write the failing test**

`scripts/bundle-ci/__tests__/stage-identity.test.ts`:

```ts
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO = join(import.meta.dir, "..", "..", "..");
const CLI = join(REPO, "scripts", "bundle-ci", "stage-identity.ts");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

function run(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { cwd: REPO });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

function app(manifest: object, icon?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "stage-cli-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify(manifest));
  if (icon !== undefined) {
    mkdirSync(join(dir, "public"), { recursive: true });
    writeFileSync(join(dir, "public", "favicon.svg"), icon);
  }
  return dir;
}

test("stages a declared identity", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-cli-out-")), "identity-stage");
  const r = run(app({ name: "chat", displayName: "Chat", icon: "./public/favicon.svg" }, SVG), out, "chat");
  expect(r.code).toBe(0);
  expect(r.out).toContain("staged identity for chat");
  expect(readFileSync(join(out, "public", "favicon.svg"), "utf8")).toBe(SVG);
});

test("an app with no identity stages nothing and succeeds", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-cli-none-")), "identity-stage");
  const r = run(app({ name: "deck" }), out, "deck");
  expect(r.code).toBe(0);
  expect(r.out).toContain("no identity declared");
  expect(existsSync(out)).toBe(false);
});

test("an invalid identity fails the leg with the reason", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-cli-bad-")), "identity-stage");
  const r = run(app({ name: "chat", displayName: "Chat", icon: "./public/favicon.svg" }, "PNG"), out, "chat");
  expect(r.code).toBe(1);
  expect(r.out).toContain("not an svg");
});

test("missing arguments print usage", () => {
  expect(run().code).toBe(2);
});

test("the staging module imports nothing at runtime from lib/, which the build job never installs", () => {
  const src = readFileSync(join(REPO, "scripts", "lib", "app-identity.ts"), "utf8");
  expect(src).not.toMatch(/^import (?!type\b)[^;]*from "\.\.\/\.\.\/lib\//m);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `bun test scripts/bundle-ci/__tests__/stage-identity.test.ts`
Expected: FAIL on the four CLI tests (`Module not found` from `bun` in the output, non-zero code). The import test passes already and pins Task 8's constraint.

- [ ] **Step 3: Implement the CLI**

`scripts/bundle-ci/stage-identity.ts`:

```ts
// Stages an app repo's launcher identity for the bundle-apps tarball. Runs
// before the app's own recipe so the identity is read from source, not from
// anything the build produced.
import { stageIdentity } from "../lib/app-identity.ts";

if (import.meta.main) {
  const [appDir, outDir, name] = process.argv.slice(2);
  if (!appDir || !outDir || !name) {
    console.error("usage: stage-identity.ts <app-dir> <out-dir> <app-name>");
    process.exit(2);
  }
  try {
    const id = stageIdentity(appDir, outDir, name);
    console.log(id ? `staged identity for ${id.name}` : "no identity declared; nothing staged");
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}
```

- [ ] **Step 4: Wire the workflow**

In `.github/workflows/bundle-apps.yml`, insert this step right after "Read and validate bundle recipe" (after line 118) and before "Refuse an already-released version":

```yaml
      # Identity is source data shipped beside the binary, never a build
      # output, so it is staged before BUILD_CMD runs.
      - name: Stage app identity
        env:
          APP_NAME: ${{ matrix.name }}
        run: bun scripts/bundle-ci/stage-identity.ts "$APP_DIR" identity-stage "$APP_NAME"
```

In "Build, smoke and stage", after the skills copy (line 162, `if [ -d "$APP_DIR/skills" ]; then cp -R "$APP_DIR/skills" stage/skills; fi`), add:

```bash
          if [ -d identity-stage ]; then cp -R identity-stage stage/identity; fi
```

"Package" (lines 335-345) already tars all of `built/`, so `identity/` rides the tarball with no further change.

- [ ] **Step 5: Run it and see it pass**

Run: `bun test scripts/bundle-ci/__tests__/stage-identity.test.ts scripts/bundle-ci/__tests__/validate-manifest.test.ts`
Expected: PASS.

Run: `actionlint .github/workflows/bundle-apps.yml`
Expected: no output, exit 0.

Run: `bunx tsc --noEmit 2>&1 | grep -E 'stage-identity|app-identity'`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add scripts/bundle-ci/stage-identity.ts scripts/bundle-ci/__tests__/stage-identity.test.ts .github/workflows/bundle-apps.yml
git commit -m "bundle-apps: stage each app's identity into its tarball" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: fetch-deps materializes identity beside the binary

**Files:**
- Modify: `scripts/fetch-deps.sh` (`unpack` line 119 and the tar branch lines 138-140; the already-unpacked check lines 276-279; the post-unpack stamps lines 288-293)
- Create: `scripts/__tests__/fetch-deps-identity.test.ts`

**Interfaces:**
- Consumes: an archive whose root holds `identity/` (Task 9).
- Produces: `rt-tray/deps/arm64/<name>-identity/` (or `$RT_DEPS_ROOT/arm64/...`) with stamp `<name>-identity.sha256` equal to the archive sha; both removed whenever the unpacked archive has no `identity/`.

- [ ] **Step 1: Write the failing test**

`scripts/__tests__/fetch-deps-identity.test.ts` (modeled on `scripts/__tests__/fetch-deps-skills.test.ts`):

```ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO = join(import.meta.dir, "..", "..");
const SCRIPT = join(REPO, "scripts", "fetch-deps.sh");

let work: string;
let lockPath: string;
let depsRoot: string;

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

function runScript(): string {
  return execFileSync("bash", [SCRIPT, "arm64"], {
    encoding: "utf8",
    env: { ...process.env, RT_DEPS_LOCK: lockPath, RT_DEPS_ROOT: depsRoot, RT_DEPS_CACHE: join(work, "cache") },
  });
}

function pin(tag: string, withIdentity: boolean): void {
  const stage = join(work, `stage-${tag}`);
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "toolx"), `#!/bin/sh\necho toolx ${tag}\n`);
  chmodSync(join(stage, "toolx"), 0o755);
  const entries = ["toolx"];
  if (withIdentity) {
    mkdirSync(join(stage, "identity", "src"), { recursive: true });
    writeFileSync(join(stage, "identity", "mattstack.deck.json"), '{"name":"toolx"}\n');
    writeFileSync(join(stage, "identity", "src", "favicon.svg"), "<svg></svg>\n");
    entries.push("identity");
  }
  const tgz = join(work, `toolx-${tag}.tgz`);
  execFileSync("tar", ["czf", tgz, "-C", stage, ...entries]);
  const sha = execFileSync("shasum", ["-a", "256", tgz], { encoding: "utf8" }).split(" ")[0]!;
  writeFileSync(lockPath, JSON.stringify({
    schema: 1, arch: "arm64",
    tools: [{
      name: "toolx", version: tag, license: "MIT",
      url: `file://${tgz}`, sha256: sha,
      archive: "tar.gz", extract: "toolx",
      bundlePath: "Contents/Helpers/toolx", exec: ["Contents/Helpers/toolx"],
      exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper",
    }],
  }));
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "fetch-identity-"));
  depsRoot = join(work, "deps");
  lockPath = join(work, "deps.lock");
  pin("1.0.0", true);
});

test("identity is materialized beside the binary with its own stamp", () => {
  runScript();
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity", "mattstack.deck.json"))).toBe(true);
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity", "src", "favicon.svg"))).toBe(true);
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity.sha256"))).toBe(true);
});

test("a deleted identity dir re-materializes despite a valid stamp", () => {
  rmSync(join(depsRoot, "arm64", "toolx-identity"), { recursive: true });
  runScript();
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity", "mattstack.deck.json"))).toBe(true);
});

test("an unchanged run with both present is a skip", () => {
  expect(runScript()).toContain("already unpacked");
});

test("a new pin without identity clears the old identity and its stamp", () => {
  pin("1.0.1", false);
  runScript();
  expect(existsSync(join(depsRoot, "arm64", "toolx"))).toBe(true);
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity"))).toBe(false);
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity.sha256"))).toBe(false);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `bun test scripts/__tests__/fetch-deps-identity.test.ts`
Expected: FAIL on `identity is materialized beside the binary` (`expected true, received false`) and on `a deleted identity dir re-materializes` (ENOENT removing a dir that was never written).

- [ ] **Step 3: Implement**

In `scripts/fetch-deps.sh`:

- `unpack` (lines 116-119): the comment and the clear become

```bash
  # Skills and identity are cleared for every archive kind, not just the tar
  # branch that can write them: a tool migrating from tar.gz to raw would
  # otherwise keep a stale tree that the post-unpack stamp then re-blesses
  # under the new sha.
  rm -rf "$dest" "$dest-skills" "$dest-identity"
```

- in the `tar.gz|tar.xz|npm` branch, after the skills copy (lines 138-140) add:

```bash
      if [ -d "$tmp/identity" ]; then
        cp -R "$tmp/identity" "$dest-identity"
      fi
```

- in the already-unpacked check, after the skills condition (lines 276-279) add:

```bash
    if [ -f "$dest-identity.sha256" ] && [ "$(cat "$dest-identity.sha256")" = "$sha" ] && [ ! -d "$dest-identity" ]; then
      already=false
    fi
```

- after the skills stamp block (lines 289-293) add:

```bash
  if [ -d "$dest-identity" ]; then
    echo "$sha" > "$dest-identity.sha256"
  else
    rm -f "$dest-identity.sha256"
  fi
```

- [ ] **Step 4: Run it and see it pass**

Run: `bun test scripts/__tests__/fetch-deps-identity.test.ts scripts/__tests__/fetch-deps-skills.test.ts scripts/__tests__/fetch-deps-make-src.test.ts`
Expected: PASS, all three files.

Run: `bash -n scripts/fetch-deps.sh`, then `shellcheck scripts/fetch-deps.sh`, then `git show origin/main:scripts/fetch-deps.sh > <scratchpad>/fetch-deps-main.sh`, then `shellcheck <scratchpad>/fetch-deps-main.sh`
Expected: `bash -n` silent; the branch's shellcheck reports no finding that main's copy does not also report.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-deps.sh scripts/__tests__/fetch-deps-identity.test.ts
git commit -m "fetch-deps: materialize <name>-identity beside the binary under its own stamp" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: build.sh lands identity; check-bundle asserts it

**Files:**
- Modify: `scripts/lib/app-identity.ts` (add `readStagedIdentity`, `landIdentities`, `checkIdentities`, CLI)
- Modify: `scripts/lib/__tests__/app-identity.test.ts`
- Modify: `rt-tray/build.sh` (`bundle_helpers`, after the `deps.lock` copy at line 273)
- Modify: `rt-tray/check-bundle.sh` (`check_helpers`, after the Helpers stowaway pass at line 412)

**Interfaces:**
- Consumes: `parseDepsLock(text): DepsLock` and `DepsLockTool` (`lib/bundle-layout.ts:17-45`, `:66-138`), the `serve` field of the shared contract (unit A), Task 8's `readDeclaredIdentity`, `serializeIdentity`, `writeIdentity`, `iconSegments`.
- Produces:
  - `export function readStagedIdentity(dir: string, name: string): AppIdentity` (throws unless dir holds a valid identity for `name` in exactly the staged form)
  - `export function landIdentities(tools: readonly DepsLockTool[], depsDir: string, resourcesDir: string): { landed: string[]; missing: string[] }` (clears `<resourcesDir>/apps`, then writes `<resourcesDir>/apps/<name>/` for each bundled helper row with `serve` whose `<depsDir>/<name>-identity` exists)
  - `export function checkIdentities(tools: readonly DepsLockTool[], resourcesDir: string): { served: string[]; problems: string[] }`
  - CLI: `bun scripts/lib/app-identity.ts land --deps <dir> --resources <dir> [--lock <path>]` and `bun scripts/lib/app-identity.ts check --resources <dir> [--lock <path>]` (default lock `rt-tray/deps.lock`; `check` exits 1 listing problems).

A row is served when it is a bundled helper row carrying `serve`. Unit A is on `main` (Task 8 Step 1 checked), so read `t.serve !== undefined` directly, with no cast.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/lib/__tests__/app-identity.test.ts` (extend the import from `../app-identity.ts` with `checkIdentities, landIdentities, readStagedIdentity`, and add `readdirSync` to the `fs` import):

```ts
import { parseDepsLock } from "../../../lib/bundle-layout.ts";

function row(name: string, extra: Record<string, unknown> = {}) {
  return {
    name, version: "1.0.0", license: "MIT",
    url: `https://example.invalid/${name}.tgz`, sha256: "a".repeat(64),
    archive: "tar.gz", extract: name,
    bundlePath: `Contents/Helpers/${name}`, exec: [`Contents/Helpers/${name}`],
    exposeByDefault: false, entitlements: "jit", status: "bundled", kind: "helper",
    ...extra,
  };
}
const served = (port: number) => ({ serve: { port, args: [] } });
function tools(rows: object[]) {
  return parseDepsLock(JSON.stringify({ schema: 1, arch: "arm64", tools: rows })).tools;
}
function depsWithBoardIdentity(): string {
  const deps = mkdtempSync(join(tmpdir(), "land-deps-"));
  stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": SVG }), join(deps, "board-identity"), "board");
  return deps;
}

test("land writes identity for served rows only and reports served rows without one", () => {
  const deps = depsWithBoardIdentity();
  stageIdentity(appDir({ ...BOARD_SOURCE, name: "gitq" }, { "src/favicon.svg": SVG }), join(deps, "gitq-identity"), "gitq");
  const resources = mkdtempSync(join(tmpdir(), "land-res-"));
  mkdirSync(join(resources, "apps", "stale"), { recursive: true });
  const result = landIdentities(tools([row("board", served(11006)), row("chat", served(11002)), row("gitq")]), deps, resources);
  expect(result).toEqual({ landed: ["board"], missing: ["chat"] });
  expect(readdirSync(join(resources, "apps"))).toEqual(["board"]);
  expect(readFileSync(join(resources, "apps", "board", "mattstack.deck.json"), "utf8")).toBe(readFileSync(join(FIXTURE, "mattstack.deck.json"), "utf8"));
  expect(readFileSync(join(resources, "apps", "board", "src", "favicon.svg"), "utf8")).toBe(SVG);
});

test("land copies only the manifest and its icon, never other files in the identity dir", () => {
  const deps = depsWithBoardIdentity();
  writeFileSync(join(deps, "board-identity", "extra.sh"), "echo hi\n");
  const resources = mkdtempSync(join(tmpdir(), "land-extra-"));
  landIdentities(tools([row("board", served(11006))]), deps, resources);
  expect(existsSync(join(resources, "apps", "board", "extra.sh"))).toBe(false);
});

test("land refuses an identity dir that names another app", () => {
  const deps = mkdtempSync(join(tmpdir(), "land-wrong-"));
  stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": SVG }), join(deps, "chat-identity"), "board");
  const resources = mkdtempSync(join(tmpdir(), "land-wrong-res-"));
  expect(() => landIdentities(tools([row("chat", served(11002))]), deps, resources)).toThrow(/names board, not chat/);
});

test("readStagedIdentity refuses a manifest that is not in the staged form", () => {
  const dir = appDir(BOARD_SOURCE, { "src/favicon.svg": SVG });
  expect(() => readStagedIdentity(dir, "board")).toThrow(/staged identity form/);
  expect(readStagedIdentity(FIXTURE, "board").displayName).toBe("Board");
});

test("check passes when Resources/apps holds exactly the served rows' identities", () => {
  const deps = depsWithBoardIdentity();
  const resources = mkdtempSync(join(tmpdir(), "check-ok-"));
  const t = tools([row("board", served(11006)), row("gitq")]);
  landIdentities(t, deps, resources);
  expect(checkIdentities(t, resources)).toEqual({ served: ["board"], problems: [] });
});

test("check names a served row with no identity and a stowaway dir", () => {
  const deps = depsWithBoardIdentity();
  const resources = mkdtempSync(join(tmpdir(), "check-bad-"));
  landIdentities(tools([row("board", served(11006))]), deps, resources);
  mkdirSync(join(resources, "apps", "gitq"), { recursive: true });
  const { problems } = checkIdentities(tools([row("board", served(11006)), row("chat", served(11002)), row("gitq")]), resources);
  expect(problems).toHaveLength(2);
  expect(problems.join("\n")).toContain("Resources/apps/gitq is not a served app in deps.lock");
  expect(problems.join("\n")).toContain("chat: served but ships no identity; re-run bundle-apps for chat");
});

test("check with no served rows and no Resources/apps is clean", () => {
  const resources = mkdtempSync(join(tmpdir(), "check-none-"));
  expect(checkIdentities(tools([row("gitq")]), resources)).toEqual({ served: [], problems: [] });
});

const CLI = join(import.meta.dir, "..", "app-identity.ts");
function lockFile(rows: object[]): string {
  const p = join(mkdtempSync(join(tmpdir(), "cli-lock-")), "deps.lock");
  writeFileSync(p, JSON.stringify({ schema: 1, arch: "arm64", tools: rows }));
  return p;
}
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args]);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test("the land and check CLI round-trip, and check exits 1 on a gap", () => {
  const deps = depsWithBoardIdentity();
  const resources = mkdtempSync(join(tmpdir(), "cli-res-"));
  const lock = lockFile([row("board", served(11006))]);
  const land = cli("land", "--deps", deps, "--resources", resources, "--lock", lock);
  expect(land.code).toBe(0);
  expect(land.out).toContain("Resources/apps/board");
  const ok = cli("check", "--resources", resources, "--lock", lock);
  expect(ok.code).toBe(0);
  expect(ok.out).toContain("identity for board");
  const gap = cli("check", "--resources", resources, "--lock", lockFile([row("board", served(11006)), row("chat", served(11002))]));
  expect(gap.code).toBe(1);
  expect(gap.out).toContain("chat: served but ships no identity");
});

test("the CLI refuses an unknown mode and a flag with no value", () => {
  expect(cli("bogus").code).toBe(2);
  expect(cli("check", "--resources").code).toBe(2);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun test scripts/lib/__tests__/app-identity.test.ts`
Expected: FAIL with `Export named 'landIdentities' not found` (the Task 8 tests stay green once it loads).

- [ ] **Step 3: Implement the functions and the CLI**

Append to `scripts/lib/app-identity.ts`, and add `existsSync, readdirSync` to its `fs` import plus this type-only import under the `path` import:

```ts
import type { DepsLockTool } from "../../lib/bundle-layout.ts";
```

```ts
/** A dir that holds `name`'s identity in exactly the form stageIdentity writes. */
export function readStagedIdentity(dir: string, name: string): AppIdentity {
  const id = readDeclaredIdentity(dir);
  if (!id) throw new Error(`${dir}: ${IDENTITY_MANIFEST} declares no displayName and icon`);
  if (id.name !== name) throw new Error(`${dir}: identity names ${id.name}, not ${name}`);
  if (readFileSync(join(dir, IDENTITY_MANIFEST), "utf8") !== serializeIdentity(id)) {
    throw new Error(`${dir}: ${IDENTITY_MANIFEST} is not in the staged identity form`);
  }
  return id;
}

function servedNames(tools: readonly DepsLockTool[]): string[] {
  return tools
    .filter((t) => t.kind === "helper" && t.status === "bundled" && t.serve !== undefined)
    .map((t) => t.name);
}

export function landIdentities(
  tools: readonly DepsLockTool[],
  depsDir: string,
  resourcesDir: string,
): { landed: string[]; missing: string[] } {
  const appsDir = join(resourcesDir, "apps");
  rmSync(appsDir, { recursive: true, force: true });
  const landed: string[] = [];
  const missing: string[] = [];
  for (const name of servedNames(tools)) {
    const src = join(depsDir, `${name}-identity`);
    if (!existsSync(src)) {
      missing.push(name);
      continue;
    }
    const id = readStagedIdentity(src, name);
    writeIdentity(id, join(src, ...iconSegments(id.icon)), join(appsDir, name));
    landed.push(name);
  }
  return { landed, missing };
}

export function checkIdentities(
  tools: readonly DepsLockTool[],
  resourcesDir: string,
): { served: string[]; problems: string[] } {
  const served = servedNames(tools);
  const appsDir = join(resourcesDir, "apps");
  const problems: string[] = [];
  for (const entry of existsSync(appsDir) ? readdirSync(appsDir) : []) {
    if (!served.includes(entry)) problems.push(`Resources/apps/${entry} is not a served app in deps.lock`);
  }
  for (const name of served) {
    if (!existsSync(join(appsDir, name))) {
      problems.push(`${name}: served but ships no identity; re-run bundle-apps for ${name} so its archive carries identity/`);
      continue;
    }
    try {
      readStagedIdentity(join(appsDir, name), name);
    } catch (err) {
      problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { served, problems };
}

if (import.meta.main) {
  const { parseDepsLock } = await import("../../lib/bundle-layout.ts");
  const args = process.argv.slice(2);
  const usage = "usage: app-identity.ts land --deps <dir> --resources <dir> [--lock <path>] | check --resources <dir> [--lock <path>]";
  const opt = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`${flag} needs a value\n${usage}`);
      process.exit(2);
    }
    return value;
  };
  const mode = args[0];
  const resources = opt("--resources");
  const deps = opt("--deps");
  const lockPath = opt("--lock") ?? join(import.meta.dir, "..", "..", "rt-tray", "deps.lock");
  if ((mode !== "land" && mode !== "check") || !resources || (mode === "land" && !deps)) {
    console.error(usage);
    process.exit(2);
  }
  const lockTools = parseDepsLock(readFileSync(lockPath, "utf8")).tools;
  if (mode === "land") {
    const { landed, missing } = landIdentities(lockTools, deps!, resources);
    for (const name of landed) console.log(`  ✓ Resources/apps/${name}`);
    for (const name of missing) console.log(`  ⚠ ${name}: served, but its archive carries no identity (check-bundle will fail)`);
  } else {
    const { served, problems } = checkIdentities(lockTools, resources);
    if (problems.length > 0) {
      console.log(problems.join("\n"));
      process.exit(1);
    }
    console.log(served.length > 0 ? `identity for ${served.join(", ")}` : "no served apps");
  }
}
```

A thrown error from `land` (an invalid or mismatched identity dir) exits non-zero with bun's stack trace, which fails `build.sh` below.

- [ ] **Step 4: Run them and see them pass**

Run: `bun test scripts/lib/__tests__/app-identity.test.ts scripts/bundle-ci/__tests__/stage-identity.test.ts`
Expected: PASS, every test (the stage-identity import guard still passes: the new import is `import type`).

Run: `bunx tsc --noEmit 2>&1 | grep -E 'app-identity'`
Expected: no output.

- [ ] **Step 5: Wire build.sh**

In `rt-tray/build.sh` `bundle_helpers`, right after `cp "$SCRIPT_DIR/deps.lock" "$CONTENTS/Resources/deps.lock"` (line 273), add:

```bash
    # Deck reads a served app's name, icon and badge from here when no
    # source checkout is linked; build it only from deps.lock's served rows.
    bun "$REPO_DIR/scripts/lib/app-identity.ts" land --deps "$DEPS_DIR" --resources "$CONTENTS/Resources" --lock "$SCRIPT_DIR/deps.lock" \
        || { echo "  ✗ app identity landing failed"; exit 1; }
    xattr -cr "$CONTENTS/Resources/apps" 2>/dev/null || true
```

- [ ] **Step 6: Wire check-bundle.sh**

In `rt-tray/check-bundle.sh` `check_helpers`, right after the Helpers stowaway pass (line 412, `[ "$stowaways" -eq 0 ] && pass "$exe Helpers holds only deps.lock-declared and first-party entries"`), add:

```bash
    # Every served deps.lock row ships its identity at Resources/apps/<name>,
    # and nothing else sits there. Judged against the bundle's own deps.lock.
    local idout
    if idout="$(bun "$SCRIPT_DIR/../scripts/lib/app-identity.ts" check --resources "$app/Contents/Resources" --lock "$app/Contents/Resources/deps.lock" 2>&1)"; then
        pass "$exe Resources/apps: $idout"
    else
        fail "$exe Resources/apps: $idout"
    fi
```

- [ ] **Step 7: Verify the wiring without building an app**

Run: `bash -n rt-tray/build.sh`, then `bash -n rt-tray/check-bundle.sh`
Expected: both silent, exit 0.

Run (a dry land and check of the real lock against empty scratch dirs under the session scratchpad; no app is built or run), one command per Bash call:

```bash
mkdir -p <scratchpad>/c-identity/deps <scratchpad>/c-identity/Resources
bun scripts/lib/app-identity.ts land --deps <scratchpad>/c-identity/deps --resources <scratchpad>/c-identity/Resources
bun scripts/lib/app-identity.ts check --resources <scratchpad>/c-identity/Resources
```

Expected: unit A's `serve` rows are on this branch's lock, so `land` exits 0 and prints one `⚠ <name>: served, but its archive carries no identity (check-bundle will fail)` line for each of board, console and chat (boxscore's row is pending, so it is not served and gets no line), and `check` exits 1 naming the same three with `re-run bundle-apps for <name>`. That is the gate working: the scratch deps dir is empty, and on `main` the same three rows stay pinned to pre-identity tarballs until the release runbook's dispatch re-releases them.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/app-identity.ts scripts/lib/__tests__/app-identity.test.ts rt-tray/build.sh rt-tray/check-bundle.sh
git commit -m "build.sh lands served apps' identity in Resources/apps; check-bundle asserts it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Document the identity channel

**Files:**
- Modify: `docs/release-and-distribution.md` (after the "Skills ride the artifacts" paragraph, lines 303-313)

- [ ] **Step 1: Write the paragraph**

Insert after the paragraph ending "maintainer-only skills off user machines." (line 313):

```markdown
Identity rides the artifacts too. Before the recipe runs, bundle-apps stages
`identity/` into the tarball: an identity-only `mattstack.deck.json` (name,
displayName, description, icon, badge, in one fixed serialized form) plus the
svg it names, validated against deck's own rules (svg-rooted, at most 64 KB,
a path inside the app dir with no dotted directories). An app whose manifest
declares no displayName or icon (deck itself) stages nothing. `fetch-deps.sh`
materializes `deps/arm64/<name>-identity/` under its own sha stamp, and
`build.sh` lands it at `Contents/Resources/apps/<name>/` for exactly the
deps.lock rows that carry `serve`. `check-bundle.sh` fails a served row with
no identity (its pin predates identity: re-run bundle-apps for it) and any
`Resources/apps` entry no served row declares. Deck reads this copy for a
managed app with no linked checkout, so prod tabs have names and icons on a
clean install.
```

- [ ] **Step 2: Check for dashes and commit**

Run: `git diff -U0 -- docs/release-and-distribution.md > <scratchpad>/c-docs.diff`, then `perl -CSD -ne 'print if /^\+.*[\x{2013}\x{2014}]/' <scratchpad>/c-docs.diff`
Expected: the second command prints nothing (older text in that doc predates the rule and is not in the diff).

```bash
git add docs/release-and-distribution.md
git commit -m "docs: the app identity channel from bundle-apps to Resources/apps" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Dry-run bundle-apps, push, and open PR C-rt

- [ ] **Step 1: Final targeted check**

Run: `bun test scripts/lib/__tests__/app-identity.test.ts scripts/bundle-ci/__tests__/stage-identity.test.ts scripts/__tests__/fetch-deps-identity.test.ts scripts/__tests__/fetch-deps-skills.test.ts lib/__tests__/deps-lock-file.test.ts`
Expected: PASS.

Run: `bunx tsc --noEmit`, then `actionlint .github/workflows/bundle-apps.yml`
Expected: both exit 0.

- [ ] **Step 2: Push**

Run: `git push -u origin rt-2-13-c-bundle-identity`

- [ ] **Step 3: Prove the tarball layout with a dry run (publishes nothing)**

```bash
gh workflow run bundle-apps.yml --repo m4ttstack/rt --ref rt-2-13-c-bundle-identity -f apps=chat -f dry_run=true
```

Wait for it (`gh run list --repo m4ttstack/rt --workflow bundle-apps.yml --branch rt-2-13-c-bundle-identity --limit 1`, then `gh run watch <id> --repo m4ttstack/rt`). Then, one command per Bash call:

```bash
gh run download <id> --repo m4ttstack/rt --name bundle-chat --dir <scratchpad>/c-dry-run
tar tzf <scratchpad>/c-dry-run/chat-darwin-arm64.tgz
```

Expected: the listing contains `./chat`, `./identity/mattstack.deck.json` and `./identity/public/favicon.svg`. Do not extract or run the binary. If the dispatch is refused (a `workflow_dispatch` on a non-default ref needs the workflow on the default branch, which it is), note it in the PR body and rely on the unit tests.

- [ ] **Step 4: Write the PR body** with the Write tool to `<scratchpad>/pr-body-c-rt.md`:

```markdown
Prod tabs had no names or icons on a clean install because nothing in the bundle carried an app's identity. This ships it the way skills already ride the app tarballs.

### What changed

**Packaging**

- Adds `scripts/lib/app-identity.ts`: validates, stages, lands and checks an identity-only `mattstack.deck.json` plus its svg.
- `bundle-apps.yml` stages `identity/` into each app tarball, read from source before the recipe runs.
- `fetch-deps.sh` materializes `deps/arm64/<name>-identity` under its own sha stamp.
- `build.sh` lands it at `Contents/Resources/apps/<name>/` for deps.lock rows with `serve`.

**Gate**

- `check-bundle.sh` fails a served row with no identity and any stray `Resources/apps` entry.

### Release order

- Merge before the 2.13.0 bundle-apps dispatch, which must list deck, boxscore, board, chat and console so every served pin carries identity.
- From this merge until that dispatch's deps.lock PR merges, `check-bundle.sh` rejects board, chat and console (still pinned to pre-identity tarballs), so no release or rehearsal is cut in between.
- The deck half (reading `Resources/apps`) is the matching m4ttstack/apps PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --repo m4ttstack/rt --base main --head rt-2-13-c-bundle-identity --title "Bundle each served app's identity at Resources/apps (2.13.0 unit C)" --body-file <scratchpad>/pr-body-c-rt.md
```

Expected: the PR URL prints.

---

## Contract notes

- **Contract 3 (identity path) refined, not changed.** The shipped `mattstack.deck.json` is an identity-only projection of the app's manifest (keys `name`, `displayName`, `description?`, `icon`, `badge?`, serialized by `serializeIdentity` in that order), not the full source manifest: deck parses the whole file with `readDeckManifest`, which rejects a malformed `dev`/`env`/`altConfigs` node, so shipping those nodes could only lose the identity. The icon ships at the same relative path the `icon` field names (for example `Resources/apps/board/src/favicon.svg`), as the contract says. Identity lands only for deps.lock rows with `serve`, so `Resources/apps/*` is exactly the served catalog, and check-bundle asserts that both ways.
- **Packaging route decided: the per-app tarball.** Identity is staged by repo-tools' `bundle-apps.yml` (there is no release workflow in m4ttstack/apps; `ci.yml` is its only workflow), carried as `identity/` in the tgz, materialized by `fetch-deps.sh`, and landed by `build.sh`, mirroring the skills channel. Consequence for the release gate (spec section I and Order step 2): board, chat and console must be re-released too, so the release runbook's single bundle-apps dispatch lists `deck,boxscore,board,chat,console`, and it runs only after both C PRs merge. PR C-apps carries the board 0.1.6, chat 0.1.3 and console 0.1.3 bumps the tag guard needs.
- **Contract 4:** unit B owns `bundleResourcesDir(execPath?)` in `apps/deck/src/services/bundle-layout.ts` (returns `<root>/Contents/Resources`). PR C-apps branches after B merges and imports it; it adds no copy and no tests of its own for it.
- **Contract 6 and the seam with B:** deck does not need `readBundleCatalog`. It keys bundled identity on the presence of `Resources/apps/<name>`, which build.sh writes only for served rows. **B must call nothing from this unit.** Identity is resolved at read time in `effectiveIdentity`, so a row B's sweep creates or adopts shows its bundled identity the moment it exists, with no ordering against the sweep and no registry write (which also keeps the older pinned deck in the other flavor unaffected, per the spec's version-skew risk). The one shared edit site is `buildDiscoveryApps`'s loop in `apps/deck/src/api/discovery.ts`: B's not-served filter is a guard before the push, this unit changes only the pushed fields; on conflict keep both.
- **`serve` read directly.** PR C-rt branches after unit A merges, so `servedNames` reads `t.serve !== undefined` on A's typed `DepsLockTool` with no cast. A's `serve` rows (board, console, chat; boxscore pending and so not served) are on `main` from then on, which is why the check-bundle identity gate bites from the moment C-rt merges and no release or rehearsal is cut until the release runbook's bot deps.lock PR re-pins those three to identity-carrying tarballs.
- **Twin fixture (new, alongside contract 5's):** `bundle-resources/apps/board/{mattstack.deck.json,src/favicon.svg}` exists byte-identically at `scripts/lib/__tests__/fixtures/` (repo-tools) and `apps/deck/src/registry/__fixtures__/` (mattstack-apps). repo-tools' test proves staging writes those bytes; deck's test proves deck reads them as board's identity. Each test carries a parity-anchor comment naming the twin.
- **Deck version:** this unit does not bump deck; its deck changes ship in B's deck 1.1.0 release, so PR C-apps must merge before the deck bundle-apps dispatch.

**Depends on:** PR C-apps on unit B (merged; it reuses `bundleResourcesDir`), PR C-rt on unit A (merged; it reads `t.serve`). Both merge before the release runbook's single `bundle-apps` dispatch (`deck,boxscore,board,chat,console`). The check-bundle identity gate bites from C-rt's merge, since A's `serve` rows are already on `main`; the bot deps.lock PR from that dispatch pins identity-carrying tarballs for every served row and ends the no-release window.
