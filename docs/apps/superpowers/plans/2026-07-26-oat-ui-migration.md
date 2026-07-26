# Oat UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Halfmoon/Radix board UI with a first-principles Oat UI implementation while preserving Alpine.js and all existing board behavior.

**Architecture:** Continue serving a static semantic HTML shell and an Alpine component from Bun. Vendor Oat's full CSS and JS bundles through the existing exact-name asset endpoint, express the board with Oat's documented semantic component markers, and retain only board-specific layout CSS.

**Tech Stack:** Bun, TypeScript, semantic HTML, Oat UI, Alpine.js, Bun test

## Global Constraints

- Preserve every existing board capability and API interaction.
- Do not change status discovery, server routes, API payloads, polling cadence, or management authorization.
- Keep Alpine.js as the state and behavior layer.
- Render all dynamic text through Alpine `x-text`; do not add dynamic `innerHTML`.
- Adopt Oat's default automatic light/dark theme.
- Keep the vendor endpoint as an exact-name allowlist.
- Keep custom CSS limited to board-specific layout, density, and interaction needs.
- Use Lucide 1.27.0's Vanilla JavaScript API with only the icons the board needs.
- Let Oat own component presentation; keep custom CSS only for `x-cloak`,
  page width, no-wrap table cells, and port editor width.

---

### Task 1: Vendor and Serve Oat

**Files:**
- Create: `src/vendor/oat.min.css`
- Create: `src/vendor/oat.min.js`
- Modify: `src/board-assets.ts`
- Modify: `src/board-assets.test.ts`

**Interfaces:**
- Consumes: `vendorAsset(name: string): Response | null`
- Produces: exact-name `/vendor/oat.min.css` and `/vendor/oat.min.js` responses with correct content types

- [ ] **Step 1: Write the failing asset tests**

Replace the shell asset assertions and vendor list in `src/board-assets.test.ts`:

```ts
test("shell references the client and the vendored assets", async () => {
  const html = await boardHtml().text();
  expect(html).toContain('src="/board.js"');
  expect(html).toContain('src="/vendor/oat.min.js"');
  expect(html).toContain('src="/vendor/alpine.min.js"');
  expect(html).toContain('href="/vendor/oat.min.css"');
  expect(html).not.toContain("halfmoon");
  expect(boardHtml().headers.get("content-type")).toContain("text/html");
});

test("vendor allowlist serves each known file with a plausible size", async () => {
  for (const name of ["oat.min.css", "oat.min.js", "alpine.min.js"]) {
    const res = vendorAsset(name);
    expect(res).not.toBeNull();
    const bytes = await res!.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1000);
  }
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `bun test src/board-assets.test.ts`

Expected: FAIL because the shell and allowlist still reference Halfmoon and `vendorAsset("oat.min.css")` returns `null`.

- [ ] **Step 3: Vendor the documented Oat bundles**

Download the bundles specified by Oat's installation documentation, pinned to
the `gh-pages` commit current when this plan was written:

```bash
curl -fL https://raw.githubusercontent.com/knadh/oat/ad0d3dca4b1700efbf6c6a7caaaccf80fe5e04aa/oat.min.css -o src/vendor/oat.min.css
curl -fL https://raw.githubusercontent.com/knadh/oat/ad0d3dca4b1700efbf6c6a7caaaccf80fe5e04aa/oat.min.js -o src/vendor/oat.min.js
```

Change the allowlist in `src/board-assets.ts` to:

```ts
const VENDOR: Record<string, string> = {
  "oat.min.css": "text/css; charset=utf-8",
  "oat.min.js": "text/javascript; charset=utf-8",
  "alpine.min.js": "text/javascript; charset=utf-8",
};
```

Change the document assets in `src/board.html` to:

```html
<link rel="stylesheet" href="/vendor/oat.min.css">
...
<script src="/board.js" defer></script>
<script src="/vendor/oat.min.js" defer></script>
<script src="/vendor/alpine.min.js" defer></script>
```

- [ ] **Step 4: Run the focused tests**

Run: `bun test src/board-assets.test.ts`

Expected: PASS for shell asset references, Alpine client safety, Oat asset serving, and traversal rejection.

- [ ] **Step 5: Remove obsolete vendored styles**

Delete only:

```text
src/vendor/halfmoon.min.css
src/vendor/halfmoon.modern.css
```

Run: `git status --short`

Expected: the two Halfmoon files are deleted, the two Oat files are added, and the asset source/test files are modified.

- [ ] **Step 6: Commit the asset migration**

```bash
git add src/board.html src/board-assets.ts src/board-assets.test.ts src/vendor/oat.min.css src/vendor/oat.min.js src/vendor/halfmoon.min.css src/vendor/halfmoon.modern.css
git commit -m "chore: replace Halfmoon assets with Oat"
```

### Task 2: Express the Board with Oat Components

**Files:**
- Modify: `src/board-assets.test.ts`
- Modify: `src/board.html`

**Interfaces:**
- Consumes: existing Alpine properties and methods from `Alpine.data("board")`
- Produces: semantic Oat alert, table, badge, switch, spinner, button, tooltip, and dialog markup

- [ ] **Step 1: Write failing semantic markup tests**

Add this test to `src/board-assets.test.ts`:

```ts
test("shell follows Oat component conventions without Bootstrap markup", async () => {
  const html = await boardHtml().text();

  expect(html).toContain('role="alert"');
  expect(html).toContain(":data-variant=");
  expect(html).toContain('class="table table-panel"');
  expect(html).toContain('role="switch"');
  expect(html).toContain("<dialog");
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('data-spinner="small"');

  expect(html).not.toContain("data-bs-");
  expect(html).not.toMatch(/\bbtn(?:-\w+)?\b/);
  expect(html).not.toContain("form-check");
  expect(html).not.toContain("modal-backdrop");
  expect(html).not.toContain("spinner-border");
  expect(html).not.toContain("text-bg-");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bun test src/board-assets.test.ts`

Expected: FAIL on the missing Oat markers and remaining Bootstrap/Halfmoon classes.

- [ ] **Step 3: Replace the Halfmoon theme layer with board-only Oat CSS**

Rewrite the inline `<style>` in `src/board.html` so it contains:

```css
[x-cloak] { display: none !important; }

.board {
  width: min(100% - (2 * var(--space-6)), 96rem);
  margin-inline: auto;
  padding-block: var(--space-10);
}
.board-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
}
.board-header h1 { margin: 0; font-size: var(--text-4); }
.board-subline {
  margin-block: var(--space-1) var(--space-6);
  color: var(--muted-foreground);
  font-size: var(--text-7);
}
.section { margin-block-start: var(--space-6); }
.section-title {
  margin: 0 0 var(--space-2);
  color: var(--muted-foreground);
  font-size: var(--text-8);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.table-panel {
  border: 1px solid var(--border);
  border-radius: var(--radius-medium);
  background: var(--card);
}
.table-panel table { min-width: 58rem; }
.table-panel th:first-child,
.table-panel td:first-child { padding-inline-start: var(--space-4); }
.table-panel th:last-child,
.table-panel td:last-child { padding-inline-end: var(--space-4); }
td { white-space: nowrap; vertical-align: middle; }
td.service-cell { width: 100%; }
.site-link { color: inherit; font-weight: var(--font-semibold); text-decoration: none; }
.site-suffix, .muted { color: var(--muted-foreground); }
.public-link { margin-inline-start: var(--space-1); color: var(--muted-foreground); }
.public-link[data-private="true"] { opacity: 0.3; }
.mono { font-family: var(--font-mono); font-size: var(--text-7); }
.align-right { text-align: end; }
.inline-actions { display: inline-flex; align-items: center; gap: var(--space-2); }
.icon-button { min-width: 2rem; }
.dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  margin-inline-end: var(--space-1);
  border-radius: var(--radius-full);
  vertical-align: 0.05rem;
}
.dot.ok { background: var(--success); }
.dot.bad { background: var(--danger); }
.dot.warn { background: var(--warning); }
.status { position: relative; }
.status.has-card { cursor: help; }
.stderr-card {
  display: none;
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 0;
  z-index: var(--z-dropdown);
  min-width: 20rem;
  max-width: 38rem;
  padding: var(--space-3);
}
.status:is(:hover, :focus-within) .stderr-card { display: block; }
.stderr-card strong {
  display: block;
  margin-block-end: var(--space-1);
  color: var(--muted-foreground);
  font-size: var(--text-8);
  text-transform: uppercase;
}
.stderr-card pre { margin: 0; white-space: pre; }
input.port-edit { display: inline-block; width: 6.5rem; margin: 0; }
.port-set { cursor: pointer; border-bottom: 1px dotted var(--muted-foreground); }
.override { cursor: pointer; font-weight: var(--font-semibold); }
.notice { flex-direction: column; margin-block-end: var(--space-6); }
.notice pre { margin: 0; user-select: all; }
.dialog-field { padding-block-end: 0; }
.board-footer {
  margin-block-start: var(--space-6);
  color: var(--faint-foreground);
  font-size: var(--text-7);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 40rem) {
  .board { width: min(100% - (2 * var(--space-4)), 96rem); }
  .board-header { align-items: flex-start; }
}
```

- [ ] **Step 4: Rewrite the page structure with documented Oat patterns**

In `src/board.html`:

- Remove `data-bs-theme` and `data-bs-core` from `<html>`.
- Use `<main class="board" x-data="board" x-cloak>`.
- Use `.board-header`, `.board-subline`, `.section`, and `.section-title` for board layout.
- Render notices as `<div role="alert" class="notice" :data-variant="proxyNotice && proxyNotice.kind === 'ok' ? 'success' : 'error'">`.
- Wrap every table in `<div class="table table-panel">`.
- Replace `text-bg-*` badge classes with `data-variant="success|warning|danger"`.
- Replace switch wrappers with a labeled native `<input type="checkbox" role="switch">`; include a dynamic accessible label.
- Replace every Bootstrap button class with Oat `.small`, `.outline`, `.ghost`, `.icon`, and `data-variant="danger"` conventions.
- Replace spinner spans with elements carrying `aria-busy="true" data-spinner="small"`.
- Preserve every `x-if`, `x-for`, `x-show`, `x-text`, event binding, URL binding, and permission condition.
- Make stderr details focus-accessible by adding `tabindex="0"` to `.status.has-card` rows through `:tabindex`.

- [ ] **Step 5: Replace the password overlay with a native dialog**

Use:

```html
<template x-if="pwModal">
  <dialog closedby="any"
          x-init="$nextTick(() => { $el.showModal(); $el.querySelector('input').focus(); })"
          @close="pwModal = null"
          @cancel="pwModal = null">
    <form @submit.prevent="savePassword()">
      <header>
        <h3 x-text="'Password for ' + pwModal.app"></h3>
        <p>Require a password before this app can be viewed publicly.</p>
      </header>
      <div class="dialog-field">
        <label data-field>
          Password
          <input type="password" placeholder="password" x-model="pwModal.value">
        </label>
      </div>
      <footer>
        <button type="button" class="outline" @click="pwModal = null">Cancel</button>
        <button type="submit" :disabled="!pwModal.value">Save</button>
      </footer>
    </form>
  </dialog>
</template>
```

- [ ] **Step 6: Run the focused tests**

Run: `bun test src/board-assets.test.ts`

Expected: PASS for Oat semantics, absence of Bootstrap/Halfmoon markers, Alpine safety, asset serving, and traversal rejection.

- [ ] **Step 7: Commit the semantic UI refactor**

```bash
git add src/board.html src/board-assets.test.ts
git commit -m "refactor: rebuild board with Oat components"
```

### Task 3: Remove Obsolete Theme Logic and Verify Behavior

**Files:**
- Modify: `src/board-assets.test.ts`
- Modify: `src/board.js`

**Interfaces:**
- Consumes: Oat's CSS `color-scheme: light dark`
- Produces: an Alpine board initializer with polling only and no UI-library-specific theme mutation

- [ ] **Step 1: Write the failing client integration assertions**

Extend the Alpine client test:

```ts
test("client registers the Alpine board component and builds no HTML", async () => {
  const js = await boardJs().text();
  expect(js).toContain('Alpine.data("board"');
  expect(js).not.toContain("innerHTML");
  expect(js).not.toContain("data-bs-theme");
  expect(js).not.toContain("applyTheme");
  expect(boardJs().headers.get("content-type")).toContain("javascript");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bun test src/board-assets.test.ts`

Expected: FAIL because `board.js` still defines and calls `applyTheme()`.

- [ ] **Step 3: Remove Halfmoon-specific theme synchronization**

Change `init()` in `src/board.js` to:

```js
init() {
  this.refresh();
  setInterval(() => this.refresh(), REFRESH_MS);
},
```

Delete the `applyTheme()` method and its `matchMedia` change listener. Do not modify any polling, derived-state, reconciliation, or action logic.

- [ ] **Step 4: Run focused and full tests**

Run: `bun test src/board-assets.test.ts`

Expected: PASS.

Run: `bun test`

Expected: 74 tests pass with 0 failures.

- [ ] **Step 5: Verify source invariants**

Run:

```bash
rg -n "halfmoon|data-bs-|text-bg-|spinner-border|modal-backdrop|form-check|\\bbtn(?:-\\w+)?\\b" src
rg -n "innerHTML" src/board.js
git diff --check
```

Expected: both searches return no matches and `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Commit the Alpine cleanup**

```bash
git add src/board.js src/board-assets.test.ts
git commit -m "refactor: let Oat manage color scheme"
```

### Task 4: Runtime Smoke Test and Final Review

**Files:**
- Modify only if verification reveals a defect in an in-scope file.

**Interfaces:**
- Consumes: complete Oat/Alpine board implementation
- Produces: verified HTML, JS, and asset responses from the Bun server

- [ ] **Step 1: Start the app**

Run: `bun run src/server.ts`

Expected: the Bun server starts without an exception.

- [ ] **Step 2: Check the served shell and assets**

From another shell, request the server's local URL and its Oat assets:

```bash
curl -fsS http://127.0.0.1:7700/ -o /tmp/local-apps-board.html
curl -fsS http://127.0.0.1:7700/vendor/oat.min.css -o /dev/null
curl -fsS http://127.0.0.1:7700/vendor/oat.min.js -o /dev/null
```

If the server reports a different port at startup, use that exact port instead of `7700`.

Expected: all three requests succeed, and the saved shell contains the Oat and Alpine asset references.

- [ ] **Step 3: Run final verification**

Run:

```bash
bun test
git diff --check
git status --short
git log --oneline --decorate -5
```

Expected: all tests pass, no whitespace errors appear, and only intentional plan tracking or runtime-fix changes remain.

- [ ] **Step 4: Commit any verification-only fixes**

If runtime verification required an in-scope correction:

```bash
git add src/board.html src/board.js src/board-assets.ts src/board-assets.test.ts
git commit -m "fix: complete Oat board migration"
```

If no corrections were needed, do not create an empty commit.

### Task 5: Adopt Oat Defaults and Lucide Icons

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/icons.js`
- Create: `src/vendor/lucide.min.js`
- Modify: `src/board-assets.ts`
- Modify: `src/board-assets.test.ts`
- Modify: `src/board.html`

**Interfaces:**
- Consumes: Lucide 1.27.0 `createIcons()` and the board's existing Alpine
  `<template>` elements
- Produces: a tree-shaken `/vendor/lucide.min.js`, Oat-default board markup,
  and table overflow that ends at the final action cell

- [ ] **Step 1: Write failing integration and regression tests**

Extend the shell and vendor tests in `src/board-assets.test.ts`:

```ts
expect(html).toContain('src="/vendor/lucide.min.js"');
expect(html).toContain('data-lucide="refresh-cw"');
expect(html).toContain('data-lucide="lock-keyhole"');
expect(html).not.toContain("<svg");
expect(html).not.toContain("↻");
expect(html).not.toContain('class="table table-panel"');
expect(html).toContain('class="table"');
expect(html).not.toMatch(/\.table-panel|\.icon-button|\.dot\b|\.stderr-card/);
expect(html).not.toMatch(/<td class="align-right">[\s\S]*?:title=/);
expect(html).not.toMatch(/<header class="hstack justify-between">[\s\S]*?<button[\s\S]*?title=/);

const lucide = vendorAsset("lucide.min.js");
expect(lucide).not.toBeNull();
expect((await lucide!.arrayBuffer()).byteLength).toBeGreaterThan(1000);
```

Add a source assertion for the icon initializer:

```ts
const icons = await Bun.file(new URL("./icons.js", import.meta.url)).text();
expect(icons).toContain("createIcons");
expect(icons).toContain("inTemplates: true");
expect(icons).not.toContain("icons,");
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `bun test src/board-assets.test.ts`

Expected: FAIL because Lucide is not served, the shell still contains
hand-authored SVG and Unicode glyphs, and the custom table/tooltip markup
remains.

- [ ] **Step 3: Add the pinned, tree-shaken Lucide bundle**

Run:

```bash
bun add --exact lucide@1.27.0
```

Create `src/icons.js`:

```js
import {
  ArrowRight,
  ExternalLink,
  FileWarning,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Zap,
  createIcons,
} from "lucide";

createIcons({
  icons: {
    ArrowRight,
    ExternalLink,
    FileWarning,
    LockKeyhole,
    RefreshCw,
    RotateCcw,
    Zap,
  },
  attrs: {
    width: 16,
    height: 16,
    "stroke-width": 2,
  },
  inTemplates: true,
});
```

Add this package script:

```json
"build:icons": "bun build src/icons.js --outfile src/vendor/lucide.min.js --minify --target=browser --format=iife"
```

Run: `bun run build:icons`

Expected: Bun writes a small browser bundle to
`src/vendor/lucide.min.js`.

- [ ] **Step 4: Serve Lucide before Alpine**

Add `"lucide.min.js": "text/javascript; charset=utf-8"` to the exact vendor
allowlist. Load scripts in this order:

```html
<script src="/vendor/oat.min.js" defer></script>
<script src="/vendor/lucide.min.js" defer></script>
<script src="/board.js" defer></script>
<script src="/vendor/alpine.min.js" defer></script>
```

This lets Lucide replace placeholders inside templates before Alpine clones
them.

- [ ] **Step 5: Replace custom visuals with Oat semantics and utilities**

In `src/board.html`:

- Replace hand-authored SVG and Unicode action glyphs with the documented
  `data-lucide` placeholders.
- Put accessible names on icon-only buttons with `aria-label`.
- Replace `.board-header`, `.section`, `.section-title`, `.muted`,
  `.inline-actions`, `.board-footer`, `.noscript`, `.site-link`,
  `.public-link`, `.icon-button`, `.dot`, and `.stderr-card` presentation
  with Oat semantic defaults and utilities.
- Wrap tables in only `<div class="table">`; remove forced widths, panel
  styling, custom edge padding, and `service-cell` width.
- Use Oat badges for running, unmanaged, and stopped service state.
- Use an Oat `<ot-dropdown>` card popover for recent stderr.
- Remove `title` from rightmost restart controls and the header proxy action
  while retaining their visible labels or `aria-label`.
- Keep custom CSS only for `[x-cloak]`, `.board`, `td` no-wrap, and
  `input.port-edit`.

- [ ] **Step 6: Run focused tests**

Run: `bun test src/board-assets.test.ts`

Expected: PASS.

- [ ] **Step 7: Verify browser geometry and behavior**

Start the server and inspect a 376px-wide viewport. At the furthest table
scroll position, assert:

```text
table right edge == final action-cell right edge
table wrapper scroll width == table width (within two CSS pixels)
document body scroll width == document body client width
```

Also verify that Lucide SVGs exist in rendered Alpine rows, switches retain
their thumbs, and the stderr popover opens.

- [ ] **Step 8: Run full verification and commit**

Run:

```bash
bun test
git diff --check
git status --short
```

Expected: all tests pass, there are no whitespace errors, and only the
intentional Task 5 files are modified.

Commit:

```bash
git add package.json bun.lock src/icons.js src/vendor/lucide.min.js \
  src/board-assets.ts src/board-assets.test.ts src/board.html
git commit -m "refactor: derive board UI from Oat defaults"
```
