# mr-board Client Refactor (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 3,169-line `src/client.tsx` into a typed, modular `src/client/` tree with zero behavior change, then land six approved UI paper cuts — all gated by a deterministic screenshot harness.

**Architecture:** Work happens in a dedicated worktree (`~/Documents/GitHub/mr-board-wt-client-refactor`, branch `refactor/client-modules`); the main checkout keeps serving the live board. A `BOARD_FIXTURE` server mode makes the worktree server bootable and inert (canned endpoints, no tokens, no timers). Playwright captures with a frozen clock are the pixel gate: refactor commits must be pixel-identical; only paper-cut commits may change pixels.

**Tech Stack:** Bun (runtime + bundler + test runner), React 19, TypeScript strict, vanilla CSS (untouched), Playwright + pixelmatch (capture harness, dev-only).

**Spec:** `docs/superpowers/specs/2026-08-19-client-refactor-design.md`

## Global Constraints

- All tasks except Task 1 run in the worktree `~/Documents/GitHub/mr-board-wt-client-refactor` on branch `refactor/client-modules`. Task 1 runs in `/Users/matt/Documents/GitHub/mr-board` (main checkout). NEVER modify the main checkout after Task 1.
- `src/style.css` is untouched except by Tasks 16 and 18 (paper cuts 1 and 3). No other task edits CSS.
- Shared pure modules stay in `src/` untouched: `view.ts`, `template.ts`, `selection.ts`, `data.ts`, `respond-outcome.ts`, `ticket.ts`.
- `ui/` never imports from `board/`; `ui/` components never take `BoardMR`.
- Every task ends with `bun test` green. Tasks marked **[PIXEL GATE]** additionally end with `bun run capture && bun run capture:compare` reporting zero diffs (except where the task states an expected, localized diff).
- Commit after every task (and at each step that says commit). Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- If a pixel gate fails and the cause isn't immediately obvious, revert the step — do not patch forward.

---

### Task 1: Commit the stacked-chains work (main checkout)

**Files:**
- Modify: nothing — commits existing dirty work in `/Users/matt/Documents/GitHub/mr-board`

- [ ] **Step 1: Verify the dirty tree is what we expect**

Run in `/Users/matt/Documents/GitHub/mr-board`:
```bash
git status --short
```
Expected dirty files exactly: `src/__tests__/view.test.ts`, `src/client.tsx`, `src/style.css`, `src/triage/stack.ts`, `src/view.ts`. If anything else is dirty, STOP and report.

- [ ] **Step 2: Run the full suite**

```bash
bun test
```
Expected: all pass. If anything fails, STOP and report — do not commit.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/view.test.ts src/client.tsx src/style.css src/triage/stack.ts src/view.ts
git commit -m "feat: stacked MR chains render as one unit (BOARD-12)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Create the worktree

- [ ] **Step 1: Create worktree + branch**

Run in `/Users/matt/Documents/GitHub/mr-board`:
```bash
git worktree add ../mr-board-wt-client-refactor -b refactor/client-modules
```

- [ ] **Step 2: Install deps and verify green**

```bash
cd ~/Documents/GitHub/mr-board-wt-client-refactor
bun install
bun test
```
Expected: install succeeds (note: `@mattstack/rt-client` is `file:../repo-tools/packages/rt-client` — resolves from the sibling path), all tests pass.

- [ ] **Step 3: Confirm the worktree has no config**

```bash
ls config.json .env 2>&1 || true
```
Expected: both absent (they're gitignored). This is why Task 3 exists.

---

### Task 3: `BOARD_FIXTURE` server mode + fixture files

**Files:**
- Modify: `src/server.ts` (config load ~line 81-98, token loads ~line 98-117, route switch in `fetch()` ~line 389, relay subscribe ~line 1362)
- Create: `tests/fixture/config.json`, `tests/fixture/README.md`
- Test: `src/__tests__/fixture-mode.test.ts`

**Interfaces:**
- Produces: env contract `BOARD_FIXTURE=<absolute dir>` — server boots from `<dir>/config.json`, serves `<dir>/data.json`, `<dir>/discussions.json`, `<dir>/review-report.md`, answers `/peer/boards` with `{"boards":[]}`, `/member?u=X` with data.json's MRs filtered by author, 501 for all POSTs. All tokens null, no rt relay subscribe, no team materialize.

- [ ] **Step 1: Write the fixture config**

Create `tests/fixture/config.json`:
```json
{
  "gitlabHost": "https://gitlab.example.com",
  "projects": ["fixture/project"],
  "rtRepos": {},
  "members": [
    { "username": "matt", "name": "Matthew Goodwin" },
    { "username": "alice", "name": "Alice Reviewer" },
    { "username": "bob", "name": "Bob Author" }
  ],
  "defaultMember": "all",
  "title": "MRs ready for review",
  "port": 7941,
  "slack": { "autoResolveIntervalMinutes": 0 }
}
```
Port 7941 is deliberately NOT the live board's 7930.

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/fixture-mode.test.ts`:
```ts
import { test, expect, afterAll } from "bun:test";
import { join } from "path";
import { mkdtempSync, writeFileSync, cpSync } from "fs";
import { tmpdir } from "os";

// Boots the real server with BOARD_FIXTURE pointing at a temp fixture dir and
// asserts the canned endpoints answer. Spawned as a subprocess because
// server.ts runs at module top level.
const dir = mkdtempSync(join(tmpdir(), "board-fixture-"));
cpSync(join(import.meta.dir, "..", "..", "tests", "fixture", "config.json"), join(dir, "config.json"));
writeFileSync(join(dir, "data.json"), JSON.stringify({
  title: "MRs ready for review", defaultMember: "all",
  members: [{ username: "matt", name: "Matthew Goodwin", count: 1 }],
  allMembers: [{ username: "matt", name: "Matthew Goodwin", hidden: false, count: 1 }],
  mrs: [{ iid: 1, title: "t", webUrl: "https://gitlab.example.com/g/p/-/merge_requests/1",
          author: { username: "matt", name: "Matthew Goodwin" },
          sourceBranch: "b", targetBranch: "main", updatedAt: "2026-08-19T00:00:00Z",
          reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
          blockers: { any: false }, reviewerComments: 0, unresolvedThreads: 0, isDraft: false }],
  fetchedAt: 1755600000000, fetchError: null, local: true, slackEnabled: false,
  slackTemplates: { single: "{title}: {url}", multiHeader: "{count} ready", multiItem: "- {title}" },
  dataSyncedAt: 1755600000000, scopeUncovered: [], scopeWindowDays: null,
  staleAfterDays: 90, canInvite: false, peering: null,
}));
writeFileSync(join(dir, "discussions.json"), JSON.stringify({ threads: [], comments: [] }));
writeFileSync(join(dir, "review-report.md"), "# canned review\n");

const PORT = 7942; // test's own port, not even the fixture default
const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "server.ts")], {
  env: { ...process.env, BOARD_FIXTURE: dir, PORT: String(PORT) },
  stdout: "pipe", stderr: "pipe",
});
afterAll(() => proc.kill());

async function ready(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("fixture server never came up");
}

test("fixture mode serves canned endpoints and refuses POSTs", async () => {
  await ready();
  const data = await (await fetch(`http://127.0.0.1:${PORT}/data.json`)).json() as { mrs: unknown[]; fetchedAt: number };
  expect(data.fetchedAt).toBe(1755600000000);
  expect(data.mrs.length).toBe(1);
  const disc = await fetch(`http://127.0.0.1:${PORT}/discussions?repo=x&iid=1&author=matt`);
  expect((await disc.json() as { threads: unknown[] }).threads).toEqual([]);
  const report = await fetch(`http://127.0.0.1:${PORT}/review/report?mr=x`);
  expect(await report.text()).toContain("canned review");
  const boards = await fetch(`http://127.0.0.1:${PORT}/peer/boards`);
  expect(await boards.json()).toEqual({ boards: [] });
  const member = await fetch(`http://127.0.0.1:${PORT}/member?u=matt`);
  expect(((await member.json()) as { mrs: unknown[] }).mrs.length).toBe(1);
  const post = await fetch(`http://127.0.0.1:${PORT}/review`, { method: "POST", body: "{}" });
  expect(post.status).toBe(501);
  const shell = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
  expect(shell).toContain('<div id="root">');
}, 30_000);
```

- [ ] **Step 3: Run it to make sure it fails**

```bash
bun test src/__tests__/fixture-mode.test.ts
```
Expected: FAIL — the server exits at boot (`config.json not found`), so `ready()` times out.

- [ ] **Step 4: Implement fixture mode in server.ts**

Four surgical guards, all keyed on one constant defined right after the imports:

```ts
/** Capture-harness mode: boot from a committed fixture dir instead of live
    config, serve canned endpoint responses, hold no tokens, start no relay.
    The seed of the permanent screenshot harness (see tests/capture.ts). */
const FIXTURE_DIR = process.env.BOARD_FIXTURE || null;
const fixtureFile = (name: string) => join(FIXTURE_DIR!, name);
```

(a) Skip team materialize and load config from the fixture (replace the two lines `materializeTeamConfigAtBoot();` and `let config = loadConfig();` — `parseConfig` is already exported from `./config.ts`, add it to the import):
```ts
if (!FIXTURE_DIR) materializeTeamConfigAtBoot();
let config = FIXTURE_DIR
  ? parseConfig(readFileSync(fixtureFile("config.json"), "utf8"))
  : loadConfig();
```

(b) Null every token in fixture mode — this alone disables GitLab name lookups (`refreshMemberNames` falls back to config names with no network), the Slack sweeper (`scheduleAutoResolve` returns when `slackToken` is null), and peering (`peering.start` never runs):
```ts
const gitlabToken = FIXTURE_DIR ? null : loadGitLabToken();
// ...
const slackToken = FIXTURE_DIR ? null : loadSlackToken();
// ...
const switchboardToken = FIXTURE_DIR ? null : loadSwitchboardToken();
// ...
const switchboardAdminToken = FIXTURE_DIR ? null : loadSwitchboardAdminToken();
```

(c) At the very top of the `fetch(req)` handler, before the existing `switch`, intercept in fixture mode. `/`, `/style.css`, `/favicon.svg`, `/app.js`, `/events`, `/healthz` fall through to the real handlers (same shell, same bundle — that's the point):
```ts
if (FIXTURE_DIR) {
  const url = new URL(req.url);
  if (req.method !== "GET") return new Response("fixture mode is read-only", { status: 501 });
  switch (url.pathname) {
    case "/data.json":
      return new Response(readFileSync(fixtureFile("data.json"), "utf8"), { headers: { "content-type": "application/json" } });
    case "/discussions":
      return new Response(readFileSync(fixtureFile("discussions.json"), "utf8"), { headers: { "content-type": "application/json" } });
    case "/review/report":
      return new Response(readFileSync(fixtureFile("review-report.md"), "utf8"), { headers: { "content-type": "text/markdown" } });
    case "/peer/boards":
      return new Response(JSON.stringify({ boards: [] }), { headers: { "content-type": "application/json" } });
    case "/member": {
      const u = url.searchParams.get("u");
      const data = JSON.parse(readFileSync(fixtureFile("data.json"), "utf8")) as { mrs: Array<{ author: { username: string } }>; fetchedAt: number };
      return new Response(JSON.stringify({ mrs: data.mrs.filter((m) => m.author.username === u), fetchedAt: data.fetchedAt }), { headers: { "content-type": "application/json" } });
    }
  }
}
```

(d) Don't subscribe to the rt relay or watch config in fixture mode — wrap the `subscribe(...)` block (~line 1362) and the `watch(dirname(CONFIG_PATH), ...)` block (~line 1378):
```ts
const stopRelay = FIXTURE_DIR ? () => {} : subscribe((type, data) => { /* existing body unchanged */ });
// ...
if (!FIXTURE_DIR) watch(dirname(CONFIG_PATH), (_event, filename) => { /* existing body unchanged */ });
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test src/__tests__/fixture-mode.test.ts && bun test
```
Expected: PASS, full suite still green.

- [ ] **Step 6: Write `tests/fixture/README.md`**

```markdown
# Capture fixture

`BOARD_FIXTURE=$(pwd)/tests/fixture bun run src/server.ts` boots an inert
board: config from this dir, canned data endpoints, no tokens, no timers,
no rt relay. Port 7941 (never the live board's 7930).

- `config.json` — committed fixture config (this dir).
- `data.json`, `discussions.json`, `review-report.md`, `meta.json` —
  committed by the baseline task; see tests/capture.ts.

`data.json` holds a real (private-repo) snapshot; timestamps are pinned and
every capture run freezes the browser clock to `meta.json`'s `now`.
```

- [ ] **Step 7: Commit**

```bash
git add src/server.ts tests/fixture src/__tests__/fixture-mode.test.ts
git commit -m "feat: BOARD_FIXTURE server mode for the capture harness

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Capture harness + baseline screenshots

**Files:**
- Create: `tests/capture.ts`, `tests/compare.ts`, `tests/fixture/data.json`, `tests/fixture/discussions.json`, `tests/fixture/review-report.md`, `tests/fixture/meta.json`, `tests/baselines/*.png`
- Modify: `package.json` (devDependencies + scripts)

**Interfaces:**
- Produces: `bun run capture` (writes `tests/.captures/*.png`), `bun run capture:baseline` (writes `tests/baselines/*.png`), `bun run capture:compare` (diffs `.captures` against `baselines`, exits non-zero on any pixel diff, prints per-file diff counts). Shot names listed in CAPTURES below are stable identifiers later tasks reference.

- [ ] **Step 1: Add dev dependencies and scripts**

```bash
bun add -d playwright pixelmatch pngjs @types/pixelmatch @types/pngjs typescript
bunx playwright install chromium
```
In `package.json` scripts add:
```json
"capture": "bun tests/capture.ts --out tests/.captures",
"capture:baseline": "bun tests/capture.ts --out tests/baselines",
"capture:compare": "bun tests/compare.ts"
```
Add `tests/.captures/` to `.gitignore`.

- [ ] **Step 2: Build the fixture data from the live board**

The live board (main checkout's launchd service) is on port 7930. Snapshot it:
```bash
curl -s http://127.0.0.1:7930/data.json > tests/fixture/data.json
curl -s "http://127.0.0.1:7930/discussions?repo=$(jq -r '.mrs[0].rtRepo' tests/fixture/data.json)&iid=$(jq -r '.mrs[0].iid' tests/fixture/data.json)&author=$(jq -r '.mrs[0].author.username' tests/fixture/data.json)" > tests/fixture/discussions.json
```
Then edit `tests/fixture/data.json` with jq/manually so it deterministically exercises the capture set. Requirements (verify each):
1. `fetchedAt` and `dataSyncedAt` set to exactly `1755600000000`.
2. At least one MR whose `stackedOn`/chain fields make `nestStacks` (src/view.ts) produce a parent with children — if the live snapshot has no stack, duplicate an MR and set its stack linkage the way `src/__tests__/view.test.ts`'s stack fixtures do.
3. At least one MR with `review: { status: "done", reportReady: true }` (opens ReviewModal).
4. At least one MR with `respond`, one with `doctor`, one with `drafts: [{ kind: "note", body: "held draft body", createdAt: 1755590000000 }]`, one with `slack: { status: "found", reactions: ["eyes"], posted: true }` — so BoardBadges renders every axis.
5. Every MR `updatedAt` earlier than the pinned time so `ago()` renders stable values.
6. `local: true`, `slackEnabled: true` (so the menu shows its slack section, disabled-marks branch is fine).
Write `tests/fixture/review-report.md` with a couple paragraphs of markdown (heading, list, code block). Write `tests/fixture/meta.json`:
```json
{ "now": 1755603600000 }
```
(one hour after `fetchedAt` → footer reads a stable "1h"-flavored age).

- [ ] **Step 3: Write tests/capture.ts**

```ts
/** Deterministic screenshot capture against the BOARD_FIXTURE server.
    Boots the server itself, freezes the page clock to fixture meta.now,
    kills CSS animations, waits for fonts, shoots the named states. */
import { chromium, type Page } from "playwright";
import { join } from "path";
import { mkdirSync, readFileSync } from "fs";

const ROOT = join(import.meta.dir, "..");
const outIdx = process.argv.indexOf("--out");
const OUT = join(ROOT, outIdx > -1 ? process.argv[outIdx + 1]! : "tests/.captures");
mkdirSync(OUT, { recursive: true });
const META = JSON.parse(readFileSync(join(ROOT, "tests/fixture/meta.json"), "utf8")) as { now: number };
const PORT = 7941;
const BASE = `http://127.0.0.1:${PORT}`;

const server = Bun.spawn(["bun", "run", join(ROOT, "src/server.ts")], {
  env: { ...process.env, BOARD_FIXTURE: join(ROOT, "tests/fixture"), PORT: String(PORT) },
  stdout: "inherit", stderr: "inherit",
});
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();

async function newPage(width: number, theme: "light" | "dark"): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 950 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(META.now);
  await page.addInitScript((mode: string) => localStorage.setItem("mrs-theme", mode), theme);
  await page.goto(BASE);
  // Kill animations/transitions so pulsing badges and spinners can't smear.
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
  await page.waitForSelector(".tui-row, .tui-card, .tui-empty");
  return page;
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log(`  ✓ ${name}`);
}

for (const theme of ["light", "dark"] as const) {
  // rows view, desktop
  let page = await newPage(1280, theme);
  await shoot(page, `rows-${theme}`);
  // row menu open (right-click the first row)
  await page.click(".tui-row", { button: "right" });
  await page.waitForSelector(".tui-menu");
  await shoot(page, `rowmenu-${theme}`);
  await page.keyboard.press("Escape");
  // comments drawer (first comments trigger, if the fixture has one)
  const trigger = page.locator(".tui-comments-btn, .tui-comment-token").first();
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForSelector(".tui-cd");
    await shoot(page, `comments-${theme}`);
    await page.keyboard.press("Escape");
  }
  // review modal (badge with a saved report)
  const reviewBtn = page.locator(".tui-review-open.tui-review-done").first();
  if (await reviewBtn.count()) {
    await reviewBtn.click();
    await page.waitForSelector(".tui-review-modal .tui-md h1, .tui-review-modal .tui-md p");
    await shoot(page, `reviewmodal-${theme}`);
    await page.keyboard.press("Escape");
  }
  // settings modal
  await page.click(".tui-side-gear");
  await page.waitForSelector(".tui-modal");
  await shoot(page, `settings-${theme}`);
  await page.keyboard.press("Escape");
  // selection bar
  await page.locator(".tui-selectbox").first().click();
  await page.waitForSelector(".tui-selbar");
  await shoot(page, `selection-${theme}`);
  await page.close();

  // grid view
  page = await newPage(1280, theme);
  await page.evaluate(() => localStorage.setItem("mrs-view", "grid"));
  await page.reload();
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  await page.waitForSelector(".tui-grid");
  await shoot(page, `grid-${theme}`);
  await page.close();

  // mobile drawer (below the 720px breakpoint)
  page = await newPage(700, theme);
  await shoot(page, `mobile-${theme}`);
  await page.click(".tui-burger");
  await page.waitForSelector(".tui-drawer");
  await shoot(page, `drawer-${theme}`);
  await page.close();

  // focus states: tab from the top and shoot the first few focus stops
  page = await newPage(1280, theme);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  await shoot(page, `focus-${theme}`);
  await page.close();
}

await browser.close();
server.kill();
console.log(`captures written to ${OUT}`);
```
If `bun tests/capture.ts` hits a Playwright/Bun runtime incompatibility, fall back to `bunx tsx tests/capture.ts` and update the package.json scripts accordingly — note it in the commit message.

- [ ] **Step 4: Write tests/compare.ts**

```ts
/** Compare tests/.captures against tests/baselines pixel-for-pixel. */
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const BASE = join(ROOT, "tests/baselines");
const CUR = join(ROOT, "tests/.captures");
let failed = false;
for (const file of readdirSync(BASE).filter((f) => f.endsWith(".png"))) {
  const cur = join(CUR, file);
  if (!existsSync(cur)) { console.error(`✗ ${file}: missing from captures`); failed = true; continue; }
  const a = PNG.sync.read(readFileSync(join(BASE, file)));
  const b = PNG.sync.read(readFileSync(cur));
  if (a.width !== b.width || a.height !== b.height) {
    console.error(`✗ ${file}: size ${a.width}x${a.height} → ${b.width}x${b.height}`); failed = true; continue;
  }
  const diff = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0 });
  if (diff > 0) { console.error(`✗ ${file}: ${diff} pixels differ`); failed = true; }
  else console.log(`✓ ${file}`);
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 5: Shoot the baseline, verify determinism, commit**

```bash
bun run capture:baseline
bun run capture && bun run capture:compare
```
Expected: second run diffs ZERO against the first. If any file diffs, the harness is not deterministic — find the source (animation, clock, font) and fix before proceeding. Then:
```bash
git add tests/ package.json bun.lock .gitignore
git commit -m "test: deterministic screenshot harness + baselines

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: tsconfig split + DOM-cast cleanup **[PIXEL GATE]**

**Files:**
- Modify: `tsconfig.json`, `package.json`, `src/client.tsx`
- Create: `src/client/tsconfig.json`

**Interfaces:**
- Produces: `bun run typecheck` = `tsc --noEmit -p . && tsc --noEmit -p src/client`. `src/client/` is the DOM-lib world; everything else stays Bun-world.

- [ ] **Step 1: Create the client tsconfig and the src/client dir**

`src/client/tsconfig.json` — note: `include`/`exclude` are NOT inherited relative to the child, and the root's `exclude` would otherwise re-exclude this very directory, so both are set explicitly here:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": []
  },
  "include": ["./**/*", "../client.tsx"],
  "exclude": []
}
```
(`../client.tsx` is temporary — Task 10 removes it when client.tsx dissolves.)

Root `tsconfig.json`: add
```json
"exclude": ["src/client", "src/client.tsx", "node_modules"]
```

- [ ] **Step 2: Add the typecheck script + types**

```bash
bun add -d @types/react@^19 @types/react-dom@^19
```
package.json scripts: `"typecheck": "tsc --noEmit -p . && tsc --noEmit -p src/client"`.

- [ ] **Step 3: Run typecheck to see the real client error list**

```bash
bunx tsc --noEmit -p src/client
```
Expected: the 38 DOM-global errors are GONE; remaining errors are the `any`-shaped ones the next step fixes (untyped json, ref types). Record the count.

- [ ] **Step 4: Clean up the casts in client.tsx**

All in `src/client.tsx` (current line numbers):
- `useRef<any>` at lines 574 (`useRevealOnChange`), 864 (`noteRef`), 2232 (`taRef`) → `useRef<HTMLElement | null>(null)`, `useRef<HTMLTextAreaElement | null>(null)`, `useRef<HTMLTextAreaElement | null>(null)` respectively.
- The four `(e.target as unknown as { value: string }).value` double-casts at lines 958, 2045, 2082, 2269 → `e.currentTarget.value`. These are all direct onChange handlers (target === currentTarget); delete the adjacent "tsconfig omits the DOM lib" / "Don't clean this up" comment blocks — they're now false.
- Do NOT touch the two bubbled-event `e.target` reads at lines 244 (`onRowClick`) and 885 (RowMenu outside-click) — those are semantically `target`, not `currentTarget`.
- Fix any remaining errors surfaced by step 3 with real types (e.g. `r.json() as Promise<T>` becomes a typed local), never `any`.

- [ ] **Step 5: Verify all gates**

```bash
bun run typecheck  # client side must be CLEAN; root side: same errors as before this task, no new ones
bun test
bun run capture && bun run capture:compare
```
Expected: client tsc clean; suite green; zero pixel diffs.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json src/client/tsconfig.json package.json bun.lock src/client.tsx
git commit -m "refactor: split client/server tsconfigs; client gets the DOM lib

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Fix the pre-existing test-file type errors

**Files:**
- Modify: `src/__tests__/board.test.ts`, `src/__tests__/peer-invite.test.ts`, `src/__tests__/peer-onboard.test.ts`, `src/__tests__/peer-outbox.test.ts` (exact files per `bunx tsc --noEmit -p .` output)

- [ ] **Step 1: Enumerate**

```bash
bunx tsc --noEmit -p . 2>&1 | head -40
```
Expected: ~25 errors — `board.test.ts:8` (BoardConfig literal missing newer required fields), `RequestInfo` not found and `typeof fetch` conversions in the peer tests.

- [ ] **Step 2: Fix each with the minimal honest change**

- BoardConfig test literals: add the missing fields with neutral values (`ticketPrefixes: []`, `botUsernames: []`, etc.) or route through a `makeConfig(overrides)` helper in the test file if three-plus literals share the shape.
- `RequestInfo`: these are test fakes for `fetch`; type the fake parameter as `Parameters<typeof fetch>[0]` instead of the DOM-lib `RequestInfo` name.
- `as unknown as typeof fetch` conversions: keep the double cast where the fake is deliberately partial, but type the fake's signature properly where cheap.
No behavior changes — types only.

- [ ] **Step 3: Verify + commit**

```bash
bun run typecheck && bun test
git add src/__tests__
git commit -m "test: fix pre-existing type errors so tsc runs clean repo-wide

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Expected: `bun run typecheck` fully green — this is the permanent state from here on; every later task keeps it green.

---

### Task 7: Mechanical move A — types + pure formatting

**Files:**
- Create: `src/client/types.ts`, `src/client/board/format.ts`
- Modify: `src/client.tsx` (delete moved code, import from new modules)
- Test: `src/__tests__/client-format.test.ts`

**Interfaces:**
- Produces `src/client/types.ts` exports: `RosterMember`, `ConfigMember`, `ReviewStatus`, `ReviewInfo`, `RespondInfo`, `DoctorStatus`, `DoctorInfo`, `DraftInfo`, `SlackInfo`, `PeerReviewInfo`, `SentNudgeInfo`, `InboundNudgeInfo`, `BoardMRWithReview`, `BoardData`, `ThemeMode`, `ViewMode`, `Toast`, `RowMenuState`, `ThreadStatus`, `CommentNote`, `CommentThread`, `GeneralComment` — exactly the interfaces currently at client.tsx lines 17-114, 774-778, 1101-1104, 1251-1254, moved verbatim (including doc comments).
- Produces `src/client/board/format.ts` exports (moved verbatim from client.tsx): `ago(iso, now)` (:198), `statusReasons(mr)` (:207), `activeReviewers(mr)` (:223), `cleanTitle(title)` (:237), `statusPhrase(mr)` (:1212), `commentCount(mr)` (:1264), `factsFor(mr)` (:1122), `mrLine(mr, tpl)` (:1135), `boardSummary(mrs, tpl, header?)` (:1142), `draftKey(mrUrl, kind)` (:476), `flattenStack(node, depth?)` (:1241), `peerState(peer)` (:394), `nudgeChipText(nudge)` (:423), `nudgeTargets(mrx)` (:467), `hasReviewReactions` (:514), `hasBoardBadges` (:522), `commentCount`, plus the label maps `REVIEW_LABEL`, `RESPOND_LABEL`, `RESPOND_ACTIVE`, `DOCTOR_LABEL`, `DOCTOR_ACTIVE`, `PEER_PHRASE`, `NUDGE_RETRYABLE`, `GROUP_LABEL`, `SORT_LABEL`, `THREAD_ICON`, `THREAD_LABEL`, and `reviewMenuItems` (:752), `respondItemLabel` (:762), `doctorItemLabel` (:768).

- [ ] **Step 1: Write the test** (these functions were untestable inside client.tsx; now they get coverage)

Create `src/__tests__/client-format.test.ts`:
```ts
import { test, expect } from "bun:test";
import { ago, cleanTitle, statusReasons, nudgeChipText, peerState } from "../client/board/format.ts";

test("ago buckets minutes, hours, days", () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  expect(ago("2026-08-19T11:30:00Z", now)).toBe("30m");
  expect(ago("2026-08-19T02:00:00Z", now)).toBe("10h");
  expect(ago("2026-08-14T12:00:00Z", now)).toBe("5d");
  expect(ago(null, now)).toBe("");
});

test("cleanTitle strips ticket prefix and draft marker", () => {
  expect(cleanTitle("ACME-2369: add the thing")).toBe("add the thing");
  expect(cleanTitle("Draft: ACME-1: x")).toBe("x");
});

test("statusReasons is 'ready to merge' with no blockers", () => {
  expect(statusReasons({ blockers: { any: false }, reviews: { given: 0, required: 0 }, unresolvedThreads: 0 } as never)).toBe("ready to merge");
});

test("nudgeChipText covers every display state", () => {
  expect(nudgeChipText({ display: "requested", reviewer: "a" })).toBe("re-review requested");
  expect(nudgeChipText({ display: "rejected", reviewer: "a", reason: "busy" })).toBe("nudge: busy");
  expect(nudgeChipText({ display: "no-response", reviewer: "a" })).toBe("no response, retry?");
});

test("peerState maps done+outcome, hides unknown statuses", () => {
  const base = { mrUrl: "u", iid: 1, reviewer: "r", updatedAt: 0 };
  expect(peerState({ ...base, status: "reviewing" })).toBe("reviewing");
  expect(peerState({ ...base, status: "done", outcome: "approve" })).toBe("approved");
  expect(peerState({ ...base, status: "someday-new-word" })).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails** (`bun test src/__tests__/client-format.test.ts` — module not found)

- [ ] **Step 3: Move the code**

Create the two files, cut the listed symbols out of client.tsx verbatim (with their doc comments), add `import`s in client.tsx for everything it still uses. `format.ts` imports from `../../data.ts`, `../../view.ts`, `../../template.ts`, `../../ticket.ts`, `../types.ts`. Nothing else changes.

- [ ] **Step 4: Verify all gates**

```bash
bun run typecheck && bun test && bun run capture && bun run capture:compare
```
Expected: green, zero diffs (the bundle content changed; the pixels must not).

- [ ] **Step 5: Commit** (`refactor: extract client types and pure formatting into src/client/`)

---

### Task 8: Mechanical move B — ui/ atoms

**Files:**
- Create: `src/client/ui/Icon.tsx`, `src/client/ui/Segmented.tsx`, `src/client/ui/CopyButton.tsx`, `src/client/ui/SelectBox.tsx`, `src/client/ui/Panel.tsx`, `src/client/ui/Toast.tsx`, `src/client/ui/Markdown.tsx`, `src/client/ui/hooks.ts`
- Modify: `src/client.tsx`

**Interfaces (all moved verbatim; signatures unchanged):**
- `Icon.tsx`: `Icon({ d, circle })` (:141), the `ICONS` record (:150), `COPY_ICON`/`CHECK_ICON` path constants (:1148).
- `Segmented.tsx`: `Segmented<T>` (:168) and `LabeledSeg<T>` (:117).
- `CopyButton.tsx`: `CopyButton({ text, className, title, label })` (:1153).
- `SelectBox.tsx`: `SelectBox({ checked, onToggle })` (:1181).
- `Panel.tsx`: `Panel({ title, count, children })` (:1526) plus `readCollapsed`/`writeCollapsed`/`PANEL_STATE_KEY` (:1502-1524).
- `Toast.tsx`: `ToastHost({ toasts })` (:1107); `Toast` type stays in `../types.ts`.
- `Markdown.tsx`: `Markdown({ children, linkTargetBlank })` — a thin wrapper over `ReactMarkdown remarkPlugins={[remarkGfm]}`, with `linkTargetBlank` adding the `components={{ a: … target="_blank" rel="noopener noreferrer" }}` override currently inlined at :1353-1356. The three ReactMarkdown call sites (:626, :1353, plus the `.tui-md` wrapper div at :625) switch to it, producing IDENTICAL DOM.
- `hooks.ts`: `useEscapeClose(onClose)` (:582), `useRevealOnChange(key)` (:573).

- [ ] **Step 1: Move each symbol, update client.tsx imports** (no test-first here — these are verbatim relocations of JSX components; the pixel gate is the test)
- [ ] **Step 2: Verify all gates** (`bun run typecheck && bun test && bun run capture && bun run capture:compare` — zero diffs)
- [ ] **Step 3: Commit** (`refactor: extract generic ui/ atoms from client.tsx`)

---

### Task 9: Mechanical move C — board/ components

**Files:**
- Create: `src/client/board/chips.tsx`, `src/client/board/RowMenu.tsx`, `src/client/board/CommentsDrawer.tsx`, `src/client/board/ReviewModal.tsx`, `src/client/board/DraftModal.tsx`, `src/client/board/SettingsModal.tsx`, `src/client/board/RowView.tsx`, `src/client/board/GridView.tsx`, `src/client/board/Sidebar.tsx`, `src/client/board/SelectionBar.tsx`, `src/client/board/Controls.tsx`, `src/client/board/StatusDot.tsx`
- Modify: `src/client.tsx`

**Interfaces (verbatim moves, current client.tsx lines):**
- `chips.tsx`: `ReviewBadge` (:300), `RespondBadge` (:330), `DoctorBadge` (:362), `PeerBadge` (:405), `NudgeChip` (:439), `NudgedByMarker` (:454), `DraftBadge` (:482), `SlackReactionChips` (:498), `SlackPostedChip` (:539), `BADGE_ICON` (:284), `PEER_GLYPH` (:377), `SLACK_ICON` (:739), plus the `SLACK_MARKS` mutable module state and `buildSlackMarks` (:726-736) — chips.tsx exports `getSlackMarks()`/`setSlackMarks(emoji)` accessors so Board's data load can keep rebuilding it (same one-writer semantics as today's module-level `let`).
- `StatusDot.tsx`: `StatusDot({ mr })` (:1198) — board/, not ui/ (takes `BoardMR`).
- `RowMenu.tsx`: `RowMenu` (:805) + `MenuItem` (:780).
- `CommentsDrawer.tsx`: `CommentsDrawer` (:1367), `CommentNoteView` (:1336), `CommentsTrigger` (:1272), `CommentsButton` (:1303), `CommentsToken` (:1323).
- `ReviewModal.tsx` (:591), `DraftModal.tsx` (:640), `SettingsModal.tsx` (:1854), `Sidebar.tsx` (:1794), `SelectionBar.tsx` (:2193), `Controls.tsx` (:2111), `RowView.tsx` (:1570) + `MetaTokens` (:1460) + `TicketLink` (:1474) + `Watching` (:1492) + `AuthorTag` (:1561) + `StatusFlags` (:1227) + `StatusPhrase` (:1245) + `onRowClick` (:243), `GridView.tsx` (:1688).
- Where RowView and GridView both need a helper (`MetaTokens`, `TicketLink`, `AuthorTag`, `StatusFlags`, `StatusPhrase`, `Watching`, `onRowClick`), put it in `RowView.tsx` and export; GridView imports from RowView. (Task 13 revisits with `BoardBadges`.)

- [ ] **Step 1: Move, update imports** (client.tsx now holds only `Board()` and the `createRoot` call)
- [ ] **Step 2: Verify all gates** (typecheck, test, capture:compare — zero diffs)
- [ ] **Step 3: Commit** (`refactor: extract board/ components from client.tsx`)

---

### Task 10: Mechanical move D — Board.tsx + main.tsx, dissolve client.tsx **[PIXEL GATE]**

**Files:**
- Create: `src/client/board/Board.tsx`, `src/client/main.tsx`
- Delete: `src/client.tsx`
- Modify: `src/server.ts:334` (entrypoint), `src/client/tsconfig.json`, root `tsconfig.json`

- [ ] **Step 1: Move `Board()` into `src/client/board/Board.tsx`; create main.tsx**

`src/client/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./board/Board.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Board />
  </StrictMode>,
);
```

- [ ] **Step 2: Flip the server entrypoint**

`src/server.ts:334`: `entrypoints: [join(import.meta.dir, "client.tsx")]` → `entrypoints: [join(import.meta.dir, "client", "main.tsx")]`.

- [ ] **Step 3: Delete client.tsx and drop the temporary tsconfig references**

Remove `"../client.tsx"` from `src/client/tsconfig.json` include; remove `"src/client.tsx"` from root exclude.

- [ ] **Step 4: Verify all gates** (typecheck, test, capture:compare — zero diffs; also `BOARD_FIXTURE=... bun run src/server.ts` boots and serves `/app.js`)
- [ ] **Step 5: Commit** (`refactor: dissolve client.tsx — board renders from src/client/`)

---

### Task 11: Characterization core — optimistic lifecycle as a tested pure unit

**Files:**
- Create: `src/client/board/optimistic.ts`
- Test: `src/__tests__/optimistic.test.ts`
- Modify: `src/client/board/Board.tsx`, `src/client/board/hooks.ts` (create)

**Interfaces:**
- Produces `src/client/board/optimistic.ts`:
  ```ts
  export type Axis = "review" | "respond" | "doctor";
  export interface OptimisticState { review: Record<string, ReviewInfo>; respond: Record<string, RespondInfo>; doctor: Record<string, DoctorInfo>; }
  export const EMPTY_OPTIMISTIC: OptimisticState;
  export function setQueued(s: OptimisticState, axis: Axis, url: string): OptimisticState;
  export function rollback(s: OptimisticState, axis: Axis, url: string): OptimisticState;
  export function clearServerTruth(s: OptimisticState, mrs: BoardMRWithReview[]): OptimisticState; // returns SAME reference when nothing changed
  export function anyActive(s: OptimisticState, mrs: BoardMRWithReview[]): boolean; // the fast-poll predicate
  export function overlay(mrs: BoardMRWithReview[], s: OptimisticState): BoardMRWithReview[]; // server state wins
  ```
- Produces `src/client/board/hooks.ts`: `useOptimisticLifecycle(data: BoardData | null)` returning `{ state, setQueued(axis, url), rollback(axis, url), active }` — a thin useState/useEffect wrapper over the pure functions.

- [ ] **Step 1: Write the characterization tests FIRST, encoding today's Board() behavior** (current sources: setQueued = handleLaunch:2532, rollback = the catch/non-ok paths, clearServerTruth = the three effects at :2867-2902, anyActive = :2906-2926, overlay = :2952-2962)

`src/__tests__/optimistic.test.ts`:
```ts
import { test, expect } from "bun:test";
import { EMPTY_OPTIMISTIC, setQueued, rollback, clearServerTruth, anyActive, overlay } from "../client/board/optimistic.ts";
import type { BoardMRWithReview } from "../client/types.ts";

const mr = (webUrl: string, extra: Partial<BoardMRWithReview> = {}) =>
  ({ webUrl, iid: 1, author: { username: "m" }, ...extra }) as BoardMRWithReview;

test("setQueued marks one axis/url queued without touching others", () => {
  const s = setQueued(EMPTY_OPTIMISTIC, "review", "u1");
  expect(s.review["u1"]).toEqual({ status: "queued" });
  expect(s.respond).toEqual({});
});

test("rollback removes exactly that entry", () => {
  let s = setQueued(EMPTY_OPTIMISTIC, "review", "u1");
  s = setQueued(s, "review", "u2");
  s = rollback(s, "review", "u1");
  expect(Object.keys(s.review)).toEqual(["u2"]);
});

test("clearServerTruth drops an optimistic entry once the server reports that axis, and returns the same reference when nothing changed", () => {
  let s = setQueued(EMPTY_OPTIMISTIC, "review", "u1");
  const cleared = clearServerTruth(s, [mr("u1", { review: { status: "reviewing" } })]);
  expect(cleared.review["u1"]).toBeUndefined();
  const untouched = clearServerTruth(cleared, [mr("u1", { review: { status: "reviewing" } })]);
  expect(untouched).toBe(cleared);
  // a server respond does NOT clear an optimistic review
  const s2 = setQueued(EMPTY_OPTIMISTIC, "review", "u1");
  expect(clearServerTruth(s2, [mr("u1", { respond: { status: "triaging" } })]).review["u1"]).toBeDefined();
});

test("anyActive: optimistic queued counts; server done does not; server triaging does", () => {
  expect(anyActive(setQueued(EMPTY_OPTIMISTIC, "doctor", "u"), [])).toBe(true);
  expect(anyActive(EMPTY_OPTIMISTIC, [mr("u", { review: { status: "done" } })])).toBe(false);
  expect(anyActive(EMPTY_OPTIMISTIC, [mr("u", { respond: { status: "triaging" } })])).toBe(true);
  expect(anyActive(EMPTY_OPTIMISTIC, [mr("u", { doctor: { status: "watching" } })])).toBe(true);
});

test("overlay: server state wins over optimistic; optimistic fills gaps only", () => {
  const s = setQueued(setQueued(EMPTY_OPTIMISTIC, "review", "u1"), "respond", "u1");
  const [out] = overlay([mr("u1", { review: { status: "error" } })], s);
  expect(out!.review).toEqual({ status: "error" });      // server wins
  expect(out!.respond).toEqual({ status: "queued" });     // optimistic fills
});
```

- [ ] **Step 2: Run to verify failure** (module not found)
- [ ] **Step 3: Implement `optimistic.ts`** (pure; `RESPOND_ACTIVE`/`DOCTOR_ACTIVE` imported from `./format.ts`; review's active set is `queued|reviewing` inline)
- [ ] **Step 4: Run tests to green**
- [ ] **Step 5: Rewire Board.tsx** — replace the three useState records, three clear-effects, three `*Active` derivations, and the overlay map (:2952-2962 equivalents) with `useOptimisticLifecycle`. The fast-poll effect keys on `active`.
- [ ] **Step 6: Verify all gates** (typecheck, test, capture:compare — zero diffs)
- [ ] **Step 7: Commit** (`refactor: one tested optimistic lifecycle replaces three copies`)

---

### Task 12: `postAction` + `useLaunchAction` — collapse the eight handlers

**Files:**
- Create: `src/client/api.ts`
- Test: `src/__tests__/client-api.test.ts`
- Modify: `src/client/board/Board.tsx`, `src/client/board/hooks.ts`

**Interfaces:**
- `src/client/api.ts`:
  ```ts
  export interface ActionResult { ok: boolean; status: number; body: { focused?: boolean; queued?: boolean; linked?: boolean; status?: string; reactions?: string[] } | null; text: string; }
  export function postAction(path: string, payload: unknown, fetcher?: typeof fetch): Promise<ActionResult>;
  // never throws: network errors return { ok:false, status:0, body:null, text:"" }
  export function getData(fresh?: boolean): Promise<BoardData>;
  export function getMember(username: string): Promise<{ mrs: BoardMRWithReview[]; fetchedAt: number }>;
  export function getDiscussions(repo: string, iid: number, author: string): Promise<{ threads: CommentThread[]; comments: GeneralComment[] }>;
  // getDiscussions wraps CommentsDrawer's inline fetch (defaults comments to []); rejects on non-ok
  ```
- `hooks.ts` also gains two mechanical extractions from Board.tsx (moved, not redesigned — the pixel gate covers them):
  ```ts
  export function useToasts(): { toasts: Toast[]; addToast: (text: string) => void };  // today's toasts/toastId/addToast block
  export function useBoardData(): {  // today's load/fetchMember/mergeMember + the 60s poll, SSE, visibility, and fast-poll effects
    data: BoardData | null; loadError: boolean;
    load: (fresh?: boolean) => Promise<void>;
    fetchMember: (username: string) => Promise<void>;
    refreshNow: () => void; refreshing: boolean;
  } // fast-poll takes the `active` boolean as a parameter: useBoardData(active: boolean)
  ```
- `hooks.ts` adds a pure, injectable flow plus the hook that closes over it:
  ```ts
  export interface LaunchFlowDeps {
    post: (payload: Record<string, unknown>) => Promise<ActionResult>;
    setQueued: () => void; rollback: () => void;    // no-ops for non-optimistic actions (resume)
    addToast: (t: string) => void; reload: () => void;
    verbing: string; noun: string;                  // toasts: `${verbing} for !N…` / `couldn't launch ${noun} for !N (status)`
  }
  export function runLaunchFlow(deps: LaunchFlowDeps, mr: BoardMR, extra: Record<string, unknown>): Promise<void>;
  export function useLaunchAction(opts: {
    axis: Axis | null; path: string;                // axis null = no optimistic state (resume actions)
    verbing: string; noun: string;
    optimistic: ReturnType<typeof useOptimisticLifecycle>;
    addToast: (t: string) => void; reload: () => void;
  }): (mr: BoardMR, extra?: Record<string, unknown>, note?: string) => void;
  ```
  Behavior (characterized from today's handleLaunch :2528-2563): set optimistic queued → toast "launching…" → postAction with `{ mrUrl, iid, note, ...extra }` → non-ok: rollback + failure toast with status → ok: `body.focused` toast when set, then reload.

- [ ] **Step 1: Write the failing tests** (inject a fake fetcher; assert the ActionResult contract for ok/non-ok/network-error, and — via a small harness calling the hook's internal flow function — the toast/rollback sequence. Export the flow as a testable pure function `runLaunchFlow(deps, mr, payload)` that the hook closes over, so the test needs no DOM:)
```ts
import { test, expect } from "bun:test";
import { postAction } from "../client/api.ts";
import { runLaunchFlow } from "../client/board/hooks.ts";

test("postAction returns typed non-ok without throwing", async () => {
  const r = await postAction("/x", {}, (async () => new Response("nope", { status: 502 })) as typeof fetch);
  expect(r).toMatchObject({ ok: false, status: 502, text: "nope" });
});
test("postAction swallows network errors as status 0", async () => {
  const r = await postAction("/x", {}, (async () => { throw new Error("down"); }) as typeof fetch);
  expect(r).toMatchObject({ ok: false, status: 0, body: null });
});
test("launch flow: ok path toasts launch then focused, reloads, no rollback", async () => {
  const events: string[] = [];
  await runLaunchFlow({
    post: async () => ({ ok: true, status: 200, body: { focused: true }, text: "" }),
    setQueued: () => events.push("queued"), rollback: () => events.push("rollback"),
    addToast: (t) => events.push(`toast:${t}`), reload: () => events.push("reload"),
    verbing: "launching review", noun: "review",
  }, { webUrl: "u", iid: 7 } as never, {});
  expect(events).toEqual(["queued", "toast:launching review for !7…", "toast:review already running for !7 — focused its tab", "reload"]);
});
test("launch flow: non-ok rolls back and toasts the status", async () => {
  const events: string[] = [];
  await runLaunchFlow({
    post: async () => ({ ok: false, status: 502, body: null, text: "" }),
    setQueued: () => events.push("queued"), rollback: () => events.push("rollback"),
    addToast: (t) => events.push(`toast:${t}`), reload: () => events.push("reload"),
    verbing: "launching review", noun: "review",
  }, { webUrl: "u", iid: 7 } as never, {});
  expect(events).toEqual(["queued", "toast:launching review for !7…", "rollback", "toast:couldn't launch review for !7 (502)"]);
});
```
- [ ] **Step 2: Run to verify failure; implement api.ts + runLaunchFlow + useLaunchAction; run to green**
- [ ] **Step 3: Rewire Board.tsx**

Six handlers become `useLaunchAction` configurations: launch review, re-review (`extra: { reReview: true }`), respond, doctor, resume review, resume respond (`extra: { resume: true }`, `axis: null` — skips setQueued/rollback, matching today's handleResume). Keep `handleNudge` and `handleDraftState` explicit but route their fetches through `postAction`. Route `handlePostSlack`/`handlePostSummary`/`handleResolveSlack`/`handleReactSlack`/`toggleMember` fetches through `postAction` too (their bespoke toast wording stays). Extract `useToasts` and `useBoardData` per the interface block (mechanical moves of the existing state/effects); `getData`/`getMember` replace the inline fetch+cast in `load`/`fetchMember`, and CommentsDrawer's inline fetch becomes `getDiscussions`.

- [ ] **Step 4: Verify all gates** (typecheck, test, capture:compare — zero diffs). Additionally do one manual behavior smoke against the fixture server: right-click a row, click "launch review", confirm a "couldn't launch" toast appears (fixture POSTs return 501 — today's board would show the same failure path).
- [ ] **Step 5: Commit** (`refactor: postAction + useLaunchAction collapse the launch handlers`)

---

### Task 13: `BoardBadges` + rowContext **[PIXEL GATE]**

**Files:**
- Create: `src/client/board/BoardBadges.tsx`
- Modify: `src/client/board/RowView.tsx`, `src/client/board/GridView.tsx`, `src/client/board/RowMenu.tsx`, `src/client/board/Board.tsx`

**Interfaces:**
- `BoardBadges.tsx`:
  ```tsx
  export function BoardBadges({ mr, now, ctx, className }: {
    mr: BoardMRWithReview; now: number; ctx: RowContext; className: string; // "tui-row-board" | "tui-card-board"
  }): ReactNode; // renders null when hasBoardBadges(mr) is false — callers drop their own guard
  ```
- `types.ts` adds:
  ```ts
  export interface RowContext {
    local: boolean; slackTemplates: SlackTemplates;
    onContext: (e: React.MouseEvent, mr: BoardMR) => void;
    onOpenReview: (mr: BoardMRWithReview) => void;
    onOpenDraft: (mr: BoardMRWithReview, draft: DraftInfo) => void;
    draftResolved: ReadonlyMap<string, "posted" | "dismissed">;
    onResumeRespond: (mr: BoardMR) => void;
    selected: ReadonlySet<string>; onToggleSelect: (webUrl: string) => void;
  }
  ```
- RowView/GridView signatures become `{ mrs, now, showAuthor, ctx }: { mrs: BoardMR[]; now: number; showAuthor: boolean; ctx: RowContext }`.
- RowMenu keeps its action callbacks (they're Board-owned handlers the menu genuinely needs) but its `local`/`slackEnabled` and the shared row callbacks come via `ctx`; net prop count drops from 22 to ~13.

- [ ] **Step 1: Extract the duplicated chip block** (RowView's and GridView's badge rows are currently identical except the wrapper class — verify with a diff before deleting) into `BoardBadges`, build `RowContext` once in Board.tsx, thread it through.
- [ ] **Step 2: Verify all gates** (typecheck, test, capture:compare — zero diffs)
- [ ] **Step 3: Commit** (`refactor: one BoardBadges + rowContext replaces duplicated chip rows`)

---

### Task 14: ui/Modal + ui/SideDrawer + shared auto-grow + scroll-lock hooks

**Files:**
- Create: `src/client/ui/Modal.tsx`, `src/client/ui/SideDrawer.tsx`
- Modify: `src/client/ui/hooks.ts`, `src/client/board/ReviewModal.tsx`, `src/client/board/DraftModal.tsx`, `src/client/board/SettingsModal.tsx`, `src/client/board/SelectionBar.tsx`, `src/client/board/RowMenu.tsx`, `src/client/board/CommentsDrawer.tsx`, `src/client/board/Board.tsx` (mobile drawer)

**Interfaces:**
- `Modal.tsx`:
  ```tsx
  export function Modal({ title, ariaLabel, onClose, className, overlayClassName, children }: {
    title: ReactNode; ariaLabel: string; onClose: () => void;
    className?: string; overlayClassName?: string; children: ReactNode;
  }): ReactNode;
  ```
  Renders exactly today's repeated skeleton: `.tui-modal-overlay` (+overlayClassName) with onClick=onClose → `.tui-modal` (+className) with stopPropagation, role="dialog", aria-modal → `.tui-modal-head` with `.tui-modal-title` and the `.tui-modal-x` close button (ICONS.close) → children. Calls `useEscapeClose(onClose)` internally. The three modals become content-only; their rendered DOM must be byte-identical to before (same class strings, same structure — the SettingsModal's `✕` text close button becomes `ICONS.close` ONLY if the pixel diff proves identical; if it diffs, keep a `closeGlyph` prop defaulting to ICONS.close and pass `"✕"` there).
- `SideDrawer.tsx`:
  ```tsx
  export function SideDrawer({ overlayClassName, panelClassName, ariaLabel, onClose, onOverlayClick, children }: {
    overlayClassName: string;  // "tui-cd-overlay" | "tui-drawer-overlay" — the two drawers keep their own CSS
    panelClassName: string;    // "tui-cd" | "tui-drawer"
    ariaLabel: string; onClose: () => void;
    onOverlayClick?: (e: React.MouseEvent) => void;  // CommentsDrawer's extra stopPropagation (it renders inside a clickable row)
    children: ReactNode;
  }): ReactNode;
  ```
  Renders overlay div (onClick = onOverlayClick ?? onClose) → panel div with stopPropagation + role="dialog" + aria-label → children, and calls `useEscapeClose(onClose)`. CommentsDrawer and the mobile drawer in Board.tsx both rewire onto it with their existing class names — identical DOM.
- `ui/hooks.ts` adds:
  ```ts
  /** Auto-grow a textarea to its content; measures the border off the element
      (scrollHeight excludes it while border-box height includes it). */
  export function useAutoGrowTextarea(deps: readonly unknown[]): RefObject<HTMLTextAreaElement | null>;
  export function useBodyScrollLock(): void; // sets body overflow hidden for the component's lifetime, restores prior value
  ```
  `useAutoGrowTextarea` replaces the two duplicated effects (SelectionBar's taRef effect and RowMenu's noteRef effect — same algorithm, currently copy-pasted). `useBodyScrollLock` extracts CommentsDrawer's existing lock (its only consumer for now; paper cut 5 adds the rest).

- [ ] **Step 1: Extract, rewire the six call sites**
- [ ] **Step 2: Verify all gates** (typecheck, test, capture:compare — zero diffs; the Modal consolidation is exactly the kind of change this gate exists for)
- [ ] **Step 3: Commit** (`refactor: shared Modal frame + auto-grow/scroll-lock hooks`)

---

### Task 15: Refresh the baseline marker (end of behavior-preserving phase)

- [ ] **Step 1: Full verification sweep**

```bash
bun run typecheck && bun test && bun run capture && bun run capture:compare
```
Expected: everything green, zero diffs against the Task 4 baselines — proof the entire refactor was pixel-preserving. Do NOT re-baseline; the original baselines stay authoritative for the paper cuts' before/after story.

- [ ] **Step 2: Commit anything pending; tag**

```bash
git tag refactor-pixel-identical
```

---

### Task 16: Paper cut 1 — solid header controls **[expected diff: header controls only]**

**Files:**
- Modify: `src/style.css:56` (`.tui-seg`), `src/style.css:67` (`.tui-copy`)

- [ ] **Step 1: Apply**

`.tui-seg { … }` gains `background: var(--panel);`
`.tui-copy { … }`: `background: transparent` → `background: var(--panel);`

- [ ] **Step 2: Verify**

`bun run capture && bun run capture:compare` — expected diffs ONLY in shots containing the header controls (`rows-*`, `grid-*`, `selection-*`, `focus-*`, `drawer-*`); confirm visually that the grid no longer shows through (open `tests/.captures/rows-light.png`). No other shot may diff.

- [ ] **Step 3: Re-baseline those shots + commit**

```bash
bun run capture:baseline
git add src/style.css tests/baselines
git commit -m "fix: header controls get a solid panel background (grid showed through)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 17: Paper cut 2 — armed re-invite replaces confirm()

**Files:**
- Modify: `src/client/board/SettingsModal.tsx` (the re-invite button, formerly client.tsx:2009-2019)

- [ ] **Step 1: Implement**

Replace the `confirm(...)` wrapper with the armed two-click pattern DraftModal uses. Add `const [armedReinvite, setArmedReinvite] = useState<string | null>(null);` (armed username, since rows repeat). First click arms: the button's label becomes `confirm re-invite`, its className becomes `tui-invite-btn copied` (the existing green-emphasis class), and its title becomes `"their current board keeps working until they use the new invite — click again to confirm"`. Second click fires `ask(m.username)`. Disarm inside `ask()` (any invite for any row) so a stray armed button never lingers.

- [ ] **Step 2: Verify** — typecheck, test; `capture:compare` (settings shots must NOT diff at rest — the armed state only exists mid-interaction). The fixture has no peered members so the button never renders there; verification of the armed flow is by code review against DraftModal's proven pattern plus confirming `grep -rn "confirm(" src/client` returns nothing.
- [ ] **Step 3: Commit** (`fix: re-invite confirms in-app instead of a native confirm()`)

---

### Task 18: Paper cut 3 — :focus-visible styles **[expected diff: focus-* shots]**

**Files:**
- Modify: `src/style.css` (one new rule near the `.tui-panel-title:focus-visible` rule at :155)

- [ ] **Step 1: Apply**

```css
/* Keyboard focus: one accent ring for the controls that lacked one. Menu
   items and the panel title already carry their own focus-visible styles. */
.tui-seg button:focus-visible, .tui-copy:focus-visible, .tui-copy-inline:focus-visible,
.tui-selectbox:focus-visible, .tui-side-item:focus-visible, .tui-side-gear:focus-visible,
.tui-burger:focus-visible, .tui-invite-btn:focus-visible, .tui-draft-act:focus-visible,
.tui-modal-x:focus-visible, .tui-comments-btn:focus-visible, .tui-comment-token:focus-visible,
.tui-join-toggle:focus-visible, .tui-drawer-action:focus-visible, .tui-review-open:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
```

- [ ] **Step 2: Verify** — `capture:compare`: ONLY `focus-light`/`focus-dark` may diff (the tab-stop shots now show rings); eyeball them. Re-baseline those two shots.
- [ ] **Step 3: Commit** (`fix: consistent :focus-visible ring on keyboard-focusable controls`)

---

### Task 19: Paper cut 4 — Escape closes only the topmost layer

**Files:**
- Modify: `src/client/ui/hooks.ts` (useEscapeClose), `src/client/board/RowMenu.tsx`, `src/client/board/CommentsDrawer.tsx`
- Test: `src/__tests__/escape-stack.test.ts`, plus a scripted Playwright assertion in `tests/capture.ts`

**Interfaces:**
- `ui/hooks.ts` gains a module-level layer stack and rewritten hook:
  ```ts
  /** LIFO stack of open layers. Escape pops only the top: with a drawer over
      a menu over the board, one press closes one layer. */
  const layerStack: Array<() => void> = [];
  let escListener: ((e: KeyboardEvent) => void) | null = null;
  export function useEscapeClose(onClose: () => void): void {
    useEffect(() => {
      layerStack.push(onClose);
      if (!escListener) {
        escListener = (e: KeyboardEvent) => {
          if (e.key !== "Escape") return;
          layerStack[layerStack.length - 1]?.();
        };
        document.addEventListener("keydown", escListener);
      }
      return () => {
        const i = layerStack.lastIndexOf(onClose);
        if (i >= 0) layerStack.splice(i, 1);
        if (layerStack.length === 0 && escListener) {
          document.removeEventListener("keydown", escListener);
          escListener = null;
        }
      };
    }, [onClose]);
  }
  ```
- RowMenu's own Escape branch in its keydown handler (`if (e.key === "Escape") onClose()`) and CommentsDrawer's inline `onKey` Escape listener are DELETED; both call `useEscapeClose(onClose)` instead. RowMenu's note-mode textarea keeps its local `stopPropagation` Escape (back-to-menu), which now works uniformly because the document listener never sees stopped events.

- [ ] **Step 1: Write the failing unit test** (pure stack semantics — export `__testLayerStack()` accessor or test through happy-path DOM-free simulation: extract the stack into `export function pushLayer(fn): () => void` + `export function handleEscape(): void`, unit-test those, and have useEscapeClose use them):
```ts
import { test, expect } from "bun:test";
import { pushLayer, handleEscape } from "../client/ui/layers.ts";

test("escape pops only the topmost layer, in LIFO order", () => {
  const fired: string[] = [];
  const popA = pushLayer(() => fired.push("a"));
  const popB = pushLayer(() => fired.push("b"));
  handleEscape();
  expect(fired).toEqual(["b"]);
  popB();
  handleEscape();
  expect(fired).toEqual(["b", "a"]);
  popA();
  handleEscape();
  expect(fired).toEqual(["b", "a"]);
});
```
(So: create `src/client/ui/layers.ts` with `pushLayer`/`handleEscape`; `useEscapeClose` becomes a thin effect over them plus the single shared document listener.)
- [ ] **Step 2: Implement; unit test green**
- [ ] **Step 3: Add the scripted assertion to tests/capture.ts** (after the rowmenu shot, before Escape-closing it):
```ts
// paper cut 4 assertion: comments drawer over the board — Escape closes it
// and does not also fire underlying layers.
const t2 = page.locator(".tui-comments-btn, .tui-comment-token").first();
if (await t2.count()) {
  await t2.click();
  await page.waitForSelector(".tui-cd");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".tui-cd", { state: "detached" });
  if (!(await page.locator(".tui-row").first().isVisible())) throw new Error("escape assertion: board vanished");
}
```
- [ ] **Step 4: Verify** (typecheck, test, capture runs green with the assertion, `capture:compare` zero diffs — this cut is behavioral, not visual)
- [ ] **Step 5: Commit** (`fix: Escape closes only the topmost open layer`)

---

### Task 20: Paper cut 5 — body scroll lock everywhere

**Files:**
- Modify: `src/client/ui/Modal.tsx` (call `useBodyScrollLock()` in the shared frame), `src/client/board/Board.tsx` (mobile drawer overlay — wrap the drawer in a tiny component so the hook scopes to its open lifetime), `src/client/board/CommentsDrawer.tsx` (drop its inline lock in favor of the hook if Task 14 didn't already)

- [ ] **Step 1: Apply** — every `.tui-modal-overlay` (via Modal) and both drawers lock body scroll for their open lifetime; nesting works because each instance restores the value it saw (the existing prevOverflow pattern, now in one place).
- [ ] **Step 2: Verify** (typecheck, test, `capture:compare` zero diffs — scrollbar-region changes don't appear because captures are fullPage against a non-overflowing fixture; behavioral confidence comes from the single shared implementation + existing CommentsDrawer test of record)
- [ ] **Step 3: Commit** (`fix: all modals and drawers lock body scroll, one shared hook`)

---

### Task 21: Paper cut 6 — RowMenu measured positioning

**Files:**
- Modify: `src/client/board/RowMenu.tsx`

- [ ] **Step 1: Implement**

Delete the estimated `W`/`H` formula (formerly client.tsx:909-912). Render the menu once at the requested coordinates with `visibility: hidden`, measure, then clamp — via `useLayoutEffect`:
```tsx
const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
useLayoutEffect(() => {
  const el = ref.current;
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  setPos({
    left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)),
  });
}, [menu.x, menu.y, noteFor]);
// style: pos ? { left: pos.left, top: pos.top } : { left: menu.x, top: menu.y, visibility: "hidden" }
```
Re-measures when note mode toggles (`noteFor`) since the menu changes size.

- [ ] **Step 2: Verify** — typecheck, test; `capture:compare`: the `rowmenu-*` shots must be pixel-identical for a menu that already fit on screen (the fixture click is mid-viewport, so clamping shouldn't move it — if it moved, the old estimate was mis-clamping and the shots diff; inspect and judge: identical = ideal, a small correction = re-baseline with justification in the commit message).
- [ ] **Step 3: Commit** (`fix: row menu clamps to the viewport by measurement, not estimate`)

---

### Task 22: Final sweep + handoff

- [ ] **Step 1: Full gate run**

```bash
bun run typecheck && bun test && bun run capture && bun run capture:compare
```

- [ ] **Step 2: Sanity-boot the real (non-fixture) server path** — confirm nothing in fixture mode leaked into normal boot: in the worktree, `bun run src/server.ts` should fail with exactly the classic `config.json not found at …` message (proof the FIXTURE_DIR guards didn't change the default path).

- [ ] **Step 3: Write the walkthrough note**

Summarize for Matt: branch, commit list (`git log --oneline main..`), how to run the worktree board against the fixture (`BOARD_FIXTURE=$(pwd)/tests/fixture bun run src/server.ts` → http://127.0.0.1:7941), the six paper-cut before/afters, and that merging + restarting launchd is his final step. Do NOT merge; the live walkthrough gate is his.
