# Re-review Latch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an MR author request a re-review by resolving a dedicated thread the reviewer's board posted, so a re-review no longer requires a peer board to nudge.

**Architecture:** The reviewer's board posts one resolvable "latch" thread when a review lands with a `comment` outcome. The author resolves it to ask; a new triage pass reads the resolved bit, runs it through the existing `decideNudge` guardrails, launches the re-review, then unresolves to rearm. An HTML-comment marker identifies latches and carries the safety invariant; a banner PNG makes them unmistakable.

**Tech Stack:** Bun, TypeScript, `@mattstack/glance` (GitLab REST/GraphQL), `@mattstack/rt-client` (daemon reads), `invadrs` (sprites), `pngjs` (image compositing), `playwright` (build-time band render only).

**Spec:** `docs/superpowers/specs/2026-09-01-re-review-latch-design.md`

## Global Constraints

- **Two repos.** Tasks 1-3 are in `~/Documents/GitHub/glance` (package `packages/glance`, published as `@mattstack/glance`). Tasks 4-12 are in `~/Documents/GitHub/board`. Board tasks 9 and 10 cannot pass their tests until glance 0.21.0 is published and installed (Task 3).
- **Markers are exact strings.** `<!-- mattstack:board re-review-latch v1 -->` and `<!-- mattstack:board re-review-latch v1 spent -->`. Never construct them by concatenation at call sites; import the constants.
- **The spent check is unconditional and runs first.** No code path may dispatch, rearm, or unresolve a latch carrying the spent marker. This is the invariant the whole design rests on.
- **Newest wins.** The canonical latch is the one whose root note has the greatest `createdAt`, ties broken by discussion id. Never oldest.
- **Every disposal of a request consumes it everywhere.** Dispatch and refusal both spend every resolved-unspent extra in the same disposal.
- **No em dashes or en dashes** in any code comment, commit message, or posted MR copy.
- Comments explain constraints the code cannot show. No narration of the next line, no decision history.

---

## File Structure

**glance (`~/Documents/GitHub/glance/packages/glance`)**

| File | Responsibility |
|---|---|
| `src/NoteMutator.ts` (modify) | Add `createDiscussion` (resolvable thread) and `uploadFile` (project uploads) |
| `tests/note-mutator.test.ts` (create) | Fetch-stubbed coverage for both new methods |

**board (`~/Documents/GitHub/board`)**

| File | Responsibility |
|---|---|
| `src/latch/markers.ts` (create) | Marker constants, classification, body construction and image-path reuse. Pure. |
| `src/latch/banner.ts` (create) | Compose the per-MR banner PNG from the committed band template plus a painted sprite |
| `src/latch/discussions.ts` (create) | Find latches in an `MRDetail`, pick the canonical one, compute the request predicate. Pure. |
| `src/latch/post.ts` (create) | Upload the banner and create/spend a latch against GitLab. The only latch module that touches the network. |
| `src/triage/latch.ts` (create) | `runLatchPass`: the ordered branch list, using injected deps |
| `scripts/build-latch-band.ts` (create) | Build-time playwright render of the band template PNG |
| `assets/latch-band.png` (create) | Committed 1656x208 band artwork, no sprite |
| `src/triage/nudge.ts` (modify) | `decideNudge` takes a source-tagged request; freshness skipped for latch |
| `src/discussions.ts` (modify) | Exclude latch threads from `reviewerComments` and `threadSummary` |
| `src/server.ts` (modify) | Post the latch on a `comment` outcome, spend it on `approve`, at `/agent/status` |
| `bin/triage.ts` (modify) | Wire `runLatchPass` beside `runNudgePass` |
| `package.json` (modify) | `pngjs` devDependency to dependency; glance floor to `^0.21.0` |

---

## Task 1: glance `NoteMutator.createDiscussion`

`createNote` posts to `/notes`, which on a GitLab MR creates a **non-resolvable** general comment. The latch must be a resolvable thread, which is `POST /discussions`.

**Files:**
- Modify: `~/Documents/GitHub/glance/packages/glance/src/NoteMutator.ts`
- Test: `~/Documents/GitHub/glance/packages/glance/tests/note-mutator.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `NoteMutator.createDiscussion(projectId: number, mrIid: number, body: string): Promise<CreatedDiscussion>` where `CreatedDiscussion = { id: string; notes: CreatedNote[] }`.

- [ ] **Step 1: Write the failing test**

Create `tests/note-mutator.test.ts`:

```ts
#!/usr/bin/env bun
/**
 * NoteMutator's discussion and upload endpoints. Both are REST-only and both
 * differ from createNote in a way that matters to callers: POST /discussions
 * yields a RESOLVABLE thread (POST /notes does not), and POST /uploads is
 * multipart rather than JSON.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { NoteMutator } from '../src/NoteMutator.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(status: number, payload: unknown): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body,
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return calls;
}

describe('createDiscussion', () => {
  test('posts to /discussions and returns the thread id', async () => {
    const calls = stub(201, {
      id: 'abc123',
      notes: [{ id: 7, body: 'hi', resolvable: true, resolved: false }],
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const created = await m.createDiscussion(42, 9, 'hi');

    expect(created.id).toBe('abc123');
    expect(created.notes[0]!.id).toBe(7);
    expect(calls[0]!.url).toBe(
      'https://gitlab.example.com/api/v4/projects/42/merge_requests/9/discussions',
    );
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['PRIVATE-TOKEN']).toBe('tok');
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ body: 'hi' });
  });

  test('throws with status and response text on failure', async () => {
    stub(403, { message: 'forbidden' });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    await expect(m.createDiscussion(42, 9, 'hi')).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/glance/packages/glance && bun test tests/note-mutator.test.ts
```

Expected: FAIL, `m.createDiscussion is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/NoteMutator.ts`. Put the interface beside `CreatedNote`:

```ts
export interface CreatedDiscussion {
  id: string;
  notes: CreatedNote[];
}
```

Add the method inside the class, after `createNote`:

```ts
  /**
   * Create a NEW discussion thread on an MR. Unlike createNote's /notes
   * endpoint, a discussion created this way is resolvable, which is the whole
   * reason to prefer it: callers that need a thread a human can resolve cannot
   * get one from /notes.
   */
  async createDiscussion(
    projectId: number,
    mrIid: number,
    body: string,
  ): Promise<CreatedDiscussion> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body }),
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.createDiscussion',
      transport: 'rest',
      method: 'POST',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      throw new Error(`createDiscussion failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as CreatedDiscussion;
  }
```

Update the file's header comment endpoint list, adding the line:

```
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/discussions
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/glance/packages/glance && bun test tests/note-mutator.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/glance && git add packages/glance/src/NoteMutator.ts packages/glance/tests/note-mutator.test.ts
git commit -m "feat(NoteMutator): add createDiscussion for resolvable threads"
```

---

## Task 2: glance `NoteMutator.uploadFile`

**Files:**
- Modify: `~/Documents/GitHub/glance/packages/glance/src/NoteMutator.ts`
- Modify: `~/Documents/GitHub/glance/packages/glance/tests/note-mutator.test.ts`

**Interfaces:**
- Consumes: the `stub` helper from Task 1's test file.
- Produces: `NoteMutator.uploadFile(projectId: number, filename: string, bytes: Uint8Array, contentType?: string): Promise<UploadedFile>` where `UploadedFile = { url: string; markdown: string; alt: string; full_path: string }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/note-mutator.test.ts`:

```ts
describe('uploadFile', () => {
  test('posts multipart to /uploads and returns the markdown path', async () => {
    const calls = stub(201, {
      alt: 'latch',
      url: '/uploads/ab12cd34/latch.png',
      full_path: '/acme/web/uploads/ab12cd34/latch.png',
      markdown: '![latch](/uploads/ab12cd34/latch.png)',
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const up = await m.uploadFile(42, 'latch.png', new Uint8Array([1, 2, 3]), 'image/png');

    expect(up.url).toBe('/uploads/ab12cd34/latch.png');
    expect(up.markdown).toBe('![latch](/uploads/ab12cd34/latch.png)');
    expect(calls[0]!.url).toBe('https://gitlab.example.com/api/v4/projects/42/uploads');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['PRIVATE-TOKEN']).toBe('tok');
    // Multipart: the body is FormData and Content-Type must NOT be set by hand,
    // or the boundary is lost.
    expect(calls[0]!.body).toBeInstanceOf(FormData);
    expect(calls[0]!.headers['Content-Type']).toBeUndefined();
  });

  test('throws with status on failure', async () => {
    stub(413, { message: 'too big' });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    await expect(
      m.uploadFile(42, 'latch.png', new Uint8Array([1]), 'image/png'),
    ).rejects.toThrow(/413/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/glance/packages/glance && bun test tests/note-mutator.test.ts
```

Expected: FAIL, `m.uploadFile is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add the interface beside `CreatedDiscussion`:

```ts
export interface UploadedFile {
  alt: string;
  url: string;
  full_path: string;
  /** Ready-to-paste markdown, e.g. `![latch](/uploads/<hash>/latch.png)`. */
  markdown: string;
}
```

Add the method to the class:

```ts
  /**
   * Upload a file to a project's markdown uploads store. The returned `url` is
   * project-relative and only renders inside that project's markdown, so an
   * upload cannot be shared across projects.
   *
   * Content-Type is deliberately unset: fetch derives the multipart boundary
   * from the FormData body, and setting the header by hand strips it.
   */
  async uploadFile(
    projectId: number,
    filename: string,
    bytes: Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<UploadedFile> {
    const path = `/api/v4/projects/${projectId}/uploads`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), filename);

    const res = await fetch(url, {
      method: "POST",
      headers: { "PRIVATE-TOKEN": this.token },
      body: form,
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.uploadFile',
      transport: 'rest',
      method: 'POST',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      throw new Error(`uploadFile failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as UploadedFile;
  }
```

Add to the header comment endpoint list:

```
 *   POST   /api/v4/projects/:id/uploads
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/glance/packages/glance && bun test tests/note-mutator.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/glance && git add packages/glance/src/NoteMutator.ts packages/glance/tests/note-mutator.test.ts
git commit -m "feat(NoteMutator): add uploadFile for project markdown uploads"
```

---

## Task 3: Publish glance 0.21.0

**Files:**
- Modify: `~/Documents/GitHub/glance/packages/glance/package.json`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `@mattstack/glance@0.21.0` on npm, exporting `CreatedDiscussion` and `UploadedFile`.

**This task needs Matt.** The npm publish prompts for an OTP, so the agent stops at the publish step and hands off.

- [ ] **Step 1: Confirm the new types are exported from the package root**

```bash
cd ~/Documents/GitHub/glance/packages/glance && grep -n "NoteMutator\|CreatedNote" src/index.ts
```

If `CreatedNote` is re-exported there, add `CreatedDiscussion` and `UploadedFile` alongside it in the same `export type { ... }` clause. If `NoteMutator` is exported but its types are not, add a type export line:

```ts
export type { CreatedNote, CreatedDiscussion, UploadedFile } from './NoteMutator.ts';
```

- [ ] **Step 2: Bump the version**

In `packages/glance/package.json`, change `"version": "0.20.0"` to `"version": "0.21.0"`.

- [ ] **Step 3: Run the full check**

```bash
cd ~/Documents/GitHub/glance/packages/glance && bun run check-types && bun test
```

Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/GitHub/glance && git add packages/glance/package.json packages/glance/src/index.ts
git commit -m "chore(glance): 0.21.0, createDiscussion and uploadFile"
```

- [ ] **Step 5: Hand off the publish**

Stop here and tell Matt: glance 0.21.0 is committed and ready, and `bun publish` from `packages/glance` needs his npm OTP. Do not attempt the publish unattended.

- [ ] **Step 6: After publish, bump the board's floor**

In `~/Documents/GitHub/board/package.json`, change `"@mattstack/glance": "^0.20.0"` to `"^0.21.0"`, then:

```bash
cd ~/Documents/GitHub/board && bun install && bun run typecheck
```

Expected: install succeeds, typecheck clean.

```bash
git add package.json bun.lock && git commit -m "deps: glance 0.21.0 for latch discussions and uploads"
```

---

## Task 4: Latch markers and body construction

Pure string work, no network. This is where the exact marker strings live.

**Files:**
- Create: `src/latch/markers.ts`
- Test: `src/__tests__/latch-markers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LATCH_MARKER: string`, `LATCH_MARKER_SPENT: string`
  - `type LatchKind = "armed" | "spent"`
  - `latchKindOf(body: string): LatchKind | null`
  - `armedLatchBody(imageMarkdown: string): string`
  - `spentLatchBody(imageMarkdown: string): string`
  - `imageMarkdownOf(body: string): string | null`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/latch-markers.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  armedLatchBody,
  imageMarkdownOf,
  LATCH_MARKER,
  LATCH_MARKER_SPENT,
  latchKindOf,
  spentLatchBody,
} from "../latch/markers.ts";

const IMG = "![re-review latch](/uploads/ab12/latch-2317.png)";

describe("latchKindOf", () => {
  test("recognizes an armed latch", () => {
    expect(latchKindOf(armedLatchBody(IMG))).toBe("armed");
  });

  test("recognizes a spent latch", () => {
    expect(latchKindOf(spentLatchBody(IMG))).toBe("spent");
  });

  test("returns null for an ordinary comment", () => {
    expect(latchKindOf("looks good to me")).toBeNull();
  });

  // A body may carry BOTH markers (a spent latch quoting the armed one, as a
  // format-migration note would). Spent must win. Flip the order of the two
  // checks in latchKindOf and this test fails.
  test("classifies a body carrying both markers as spent", () => {
    expect(latchKindOf(`${LATCH_MARKER_SPENT}\n\nquoted: ${LATCH_MARKER}`)).toBe("spent");
  });

  // Version skew: a v1 board must ignore a marker it does not understand
  // rather than acting on it with v1 rules.
  test("ignores a v2 marker", () => {
    expect(latchKindOf("<!-- mattstack:board re-review-latch v2 -->\n\nhi")).toBeNull();
  });
});

describe("bodies", () => {
  test("armed body leads with the marker and carries the image", () => {
    const body = armedLatchBody(IMG);
    expect(body.startsWith(LATCH_MARKER)).toBe(true);
    expect(body).toContain(IMG);
    expect(body).toContain("Resolve this thread");
  });

  test("spent body leads with the spent marker and keeps the image", () => {
    const body = spentLatchBody(IMG);
    expect(body.startsWith(LATCH_MARKER_SPENT)).toBe(true);
    expect(body).toContain(IMG);
  });

  test("neither body uses an em dash or en dash", () => {
    expect(armedLatchBody(IMG)).not.toMatch(/[–—]/);
    expect(spentLatchBody(IMG)).not.toMatch(/[–—]/);
  });
});

describe("imageMarkdownOf", () => {
  // The spend reuses the already-uploaded banner rather than uploading again,
  // so it has to read the path back out of the armed body.
  test("round-trips the image out of an armed body", () => {
    expect(imageMarkdownOf(armedLatchBody(IMG))).toBe(IMG);
  });

  test("round-trips the image out of a spent body", () => {
    expect(imageMarkdownOf(spentLatchBody(IMG))).toBe(IMG);
  });

  test("returns null when there is no image", () => {
    expect(imageMarkdownOf(`${LATCH_MARKER}\n\nno picture here`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/latch-markers.test.ts
```

Expected: FAIL, cannot resolve `../latch/markers.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/latch/markers.ts`:

```ts
/**
 * The latch's machine markers and the bodies built around them.
 *
 * Detection depends on the marker and never on the banner image, so a blocked,
 * broken or missing image can never break the latch. Spent is checked first
 * because a body may carry both markers, and a spent latch that quotes the
 * armed one must not read as armed: that is what would let the board rearm a
 * spent latch and re-block a merge.
 */

export const LATCH_MARKER = "<!-- mattstack:board re-review-latch v1 -->";
export const LATCH_MARKER_SPENT = "<!-- mattstack:board re-review-latch v1 spent -->";

export type LatchKind = "armed" | "spent";

/** Which latch a note body is, or null if it is not a latch this board knows.
    An unrecognized version (v2 from a newer board) is null, not armed. */
export function latchKindOf(body: string): LatchKind | null {
  if (body.includes(LATCH_MARKER_SPENT)) return "spent";
  if (body.includes(LATCH_MARKER)) return "armed";
  return null;
}

const ARMED_COPY = [
  "**Addressed everything?** Resolve this thread and I'll take another pass over the MR.",
  "",
  "Leave it open while there's still work in flight.",
].join("\n");

const SPENT_COPY = "Approved, so this latch is spent. Nothing further to do here.";

export function armedLatchBody(imageMarkdown: string): string {
  return `${LATCH_MARKER}\n\n${imageMarkdown}\n\n${ARMED_COPY}\n`;
}

export function spentLatchBody(imageMarkdown: string): string {
  return `${LATCH_MARKER_SPENT}\n\n${imageMarkdown}\n\n${SPENT_COPY}\n`;
}

/** The banner's markdown image, pulled back out of a latch body so the spend
    can reuse the uploaded path instead of uploading the banner a second time. */
export function imageMarkdownOf(body: string): string | null {
  const m = body.match(/!\[[^\]]*\]\([^)]+\)/);
  return m ? m[0] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/latch-markers.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/latch/markers.ts src/__tests__/latch-markers.test.ts
git commit -m "add src/latch/markers.ts: latch marker constants and bodies"
```

---

## Task 5: The banner PNG

The band artwork is rendered once at build time (playwright, a devDependency already used by the capture tests) and committed. At post time the per-MR sprite is painted into a copy of that buffer with `pngjs`. Nothing rasterizes SVG or renders text at runtime.

**Files:**
- Create: `scripts/build-latch-band.ts`
- Create: `assets/latch-band.png` (generated by the script, committed)
- Create: `src/latch/banner.ts`
- Test: `src/__tests__/latch-banner.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `latchBannerPng(mrUrl: string, bandPath?: string): Buffer` returning PNG bytes, and the constants `BAND_W = 1656`, `BAND_H = 208`.

- [ ] **Step 1: Move pngjs to a runtime dependency**

In `package.json`, cut `"pngjs": "^7.0.0"` from `devDependencies` and add it to `dependencies`. Leave `@types/pngjs` in `devDependencies`. Then:

```bash
cd ~/Documents/GitHub/board && bun install
```

- [ ] **Step 2: Write the band build script**

Create `scripts/build-latch-band.ts`:

```ts
/**
 * Renders the latch banner's fixed artwork to assets/latch-band.png, once, at
 * build time. Text is the only reason a browser is involved: the runtime
 * compositor paints sprite pixels and cannot render glyphs. Re-run by hand
 * after changing the band's look, and commit the result.
 *
 *   bun run scripts/build-latch-band.ts
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const W = 1656;
const H = 208;
// Left inset reserved for the sprite the runtime paints in; the artwork must
// leave it empty or the sprite lands on top of the band's own pixels.
const SPRITE_BOX = 120 + 60 * 2;

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
  html, body { margin: 0; padding: 0; }
  .band {
    width: ${W}px; height: ${H}px; box-sizing: border-box;
    display: flex; align-items: center;
    padding: 0 60px 0 ${SPRITE_BOX}px;
    background: #161224;
    background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 6px);
  }
  .stack { display: flex; flex-direction: column; gap: 18px; width: 100%; }
  .title { font-family: 'Silkscreen', 'Courier New', monospace; font-weight: 700;
           font-size: 50px; letter-spacing: 0.08em; color: #f6f2ff; line-height: 1; }
  .rule { height: 4px; background: #ff6b9d; width: 100%; }
  .sub { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 24px;
         letter-spacing: 0.16em; color: #ff6b9d; text-transform: uppercase; }
</style>
<div class="band"><div class="stack">
  <div class="title">RE-REVIEW LATCH</div>
  <div class="rule"></div>
  <div class="sub">resolve this thread to summon another pass</div>
</div></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
mkdirSync(join(import.meta.dir, "..", "assets"), { recursive: true });
await page.locator(".band").screenshot({
  path: join(import.meta.dir, "..", "assets", "latch-band.png"),
});
await browser.close();
console.log(`wrote assets/latch-band.png (${W}x${H})`);
```

- [ ] **Step 3: Generate and eyeball the band**

```bash
cd ~/Documents/GitHub/board && bun run scripts/build-latch-band.ts && open assets/latch-band.png
```

Expected: a 1656x208 dark band with "RE-REVIEW LATCH", a pink rule, the caption, and an empty square on the left where the sprite goes.

- [ ] **Step 4: Write the failing test**

Create `src/__tests__/latch-banner.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import { BAND_H, BAND_W, latchBannerPng } from "../latch/banner.ts";

const MR_A = "https://gitlab.com/acme/web/-/merge_requests/2317";
const MR_B = "https://gitlab.com/acme/web/-/merge_requests/2318";

function decode(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}

describe("latchBannerPng", () => {
  test("returns a PNG at the band's dimensions", () => {
    const png = decode(latchBannerPng(MR_A));
    expect(png.width).toBe(BAND_W);
    expect(png.height).toBe(BAND_H);
  });

  // The sprite is the per-MR part, so two MRs must not produce identical bytes.
  test("differs between MRs", () => {
    expect(latchBannerPng(MR_A).equals(latchBannerPng(MR_B))).toBe(false);
  });

  // invadrs freezes its hash, so the same MR must render the same banner forever.
  test("is deterministic for one MR", () => {
    expect(latchBannerPng(MR_A).equals(latchBannerPng(MR_A))).toBe(true);
  });

  test("paints the sprite in the board pink, not a palette colour", () => {
    const png = decode(latchBannerPng(MR_A));
    // Count ONLY inside the sprite box. The band's own pink rule spans the full
    // width, so a whole-image count would pass even with sprite painting broken.
    let pink = 0;
    for (let y = 44; y < 44 + 120; y++) {
      for (let x = 120; x < 120 + 120; x++) {
        const i = (png.width * y + x) << 2;
        if (png.data[i] === 0xff && png.data[i + 1] === 0x6b && png.data[i + 2] === 0x9d) pink++;
      }
    }
    expect(pink).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/latch-banner.test.ts
```

Expected: FAIL, cannot resolve `../latch/banner.ts`.

- [ ] **Step 6: Write minimal implementation**

Create `src/latch/banner.ts`:

```ts
/**
 * The per-MR latch banner: the committed band artwork with this MR's invadrs
 * creature painted into the reserved box on its left.
 *
 * The sprite colour is forced rather than taken from the palette. A palette
 * pick like ocean's #1d3557 would be invisible on the near-black band; the
 * per-MR character comes from the creature's shape, and pink holds 6.84:1.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PNG } from "pngjs";
import { resolveSpawn } from "invadrs";
import { APP_ROOT } from "../app-root.ts";

export const BAND_W = 1656;
export const BAND_H = 208;

const SPRITE_PINK = { r: 0xff, g: 0x6b, b: 0x9d };
/** Top-left of the sprite box inside the band, and its side, in band pixels.
    Must match the left padding reserved by scripts/build-latch-band.ts. */
const SPRITE_X = 120;
const SPRITE_Y = 44;
const SPRITE_SIDE = 120;

// Resolves from a checkout, which is how the triage pass runs today. In the
// compiled binary APP_ROOT is ~/.mattstack/board and this path does not exist,
// so the pending board-binary embed work has to carry this asset too.
const DEFAULT_BAND = join(APP_ROOT, "assets", "latch-band.png");

export function latchBannerPng(mrUrl: string, bandPath: string = DEFAULT_BAND): Buffer {
  const band = PNG.sync.read(readFileSync(bandPath));
  const { grid, padding } = resolveSpawn(mrUrl);

  // resolveSpawn's viewBox spans grid + padding on every side, so a cell at
  // index i sits at unit (i + padding) and one unit is side / (n + 2 * padding).
  const units = grid.length + padding * 2;
  const cell = SPRITE_SIDE / units;

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row]!.length; col++) {
      if (!grid[row]![col]) continue;
      const x0 = Math.round(SPRITE_X + (col + padding) * cell);
      const y0 = Math.round(SPRITE_Y + (row + padding) * cell);
      const x1 = Math.round(SPRITE_X + (col + padding + 1) * cell);
      const y1 = Math.round(SPRITE_Y + (row + padding + 1) * cell);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (band.width * y + x) << 2;
          band.data[i] = SPRITE_PINK.r;
          band.data[i + 1] = SPRITE_PINK.g;
          band.data[i + 2] = SPRITE_PINK.b;
          band.data[i + 3] = 0xff;
        }
      }
    }
  }
  return PNG.sync.write(band);
}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/latch-banner.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock scripts/build-latch-band.ts assets/latch-band.png src/latch/banner.ts src/__tests__/latch-banner.test.ts
git commit -m "add src/latch/banner.ts: per-MR latch banner from a committed band"
```

---

## Task 6: Latch discovery and the request predicate

The mechanism the design work broke and repaired repeatedly. Pure, and tested hard.

**Files:**
- Create: `src/latch/discussions.ts`
- Test: `src/__tests__/latch-discussions.test.ts`

**Interfaces:**
- Consumes: `latchKindOf`, `LatchKind` from Task 4.
- Produces:
  - `interface LatchRef { discussionId: string; rootNoteId: number; kind: LatchKind; resolved: boolean; createdAt: string; body: string }`
  - `findLatches(detail: MRDetail): LatchRef[]` sorted newest first
  - `canonicalLatch(latches: LatchRef[]): LatchRef | null`
  - `requestCarriers(latches: LatchRef[]): LatchRef[]` (every armed and resolved latch)
  - `hasRequest(latches: LatchRef[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/latch-discussions.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { MRDetail } from "@mattstack/glance";
import { armedLatchBody, spentLatchBody } from "../latch/markers.ts";
import {
  canonicalLatch,
  findLatches,
  hasRequest,
  requestCarriers,
} from "../latch/discussions.ts";

const IMG = "![re-review latch](/uploads/ab12/latch.png)";

function disc(id: string, body: string, createdAt: string, resolved: boolean) {
  return {
    id,
    resolvable: true,
    resolved,
    notes: [
      {
        id: 1,
        body,
        author: { id: 1, username: "matt", name: "Matt", avatarUrl: null },
        createdAt,
        system: false,
        type: "DiscussionNote",
        resolvable: true,
        resolved,
        position: null,
      },
    ],
  };
}

function detail(...discussions: ReturnType<typeof disc>[]): MRDetail {
  return { mrIid: 1, repositoryId: "gitlab:42", discussions } as unknown as MRDetail;
}

describe("findLatches", () => {
  test("ignores ordinary discussions", () => {
    const d = detail(disc("d1", "please rename this", "2026-09-01T10:00:00Z", false));
    expect(findLatches(d)).toEqual([]);
  });

  test("finds armed and spent latches with their state", () => {
    const d = detail(
      disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false),
      disc("d2", spentLatchBody(IMG), "2026-09-01T09:00:00Z", true),
    );
    const found = findLatches(d);
    expect(found.map((l) => [l.discussionId, l.kind, l.resolved])).toEqual([
      ["d1", "armed", false],
      ["d2", "spent", true],
    ]);
  });

  test("reads the marker from the ROOT note only", () => {
    // A reply quoting the marker must not turn a normal thread into a latch.
    const d = detail({
      ...disc("d1", "please rename this", "2026-09-01T10:00:00Z", false),
      notes: [
        disc("d1", "please rename this", "2026-09-01T10:00:00Z", false).notes[0]!,
        { ...disc("x", armedLatchBody(IMG), "2026-09-01T11:00:00Z", false).notes[0]!, id: 2 },
      ],
    });
    expect(findLatches(d)).toEqual([]);
  });

  test("sorts newest first", () => {
    const d = detail(
      disc("old", spentLatchBody(IMG), "2026-08-01T10:00:00Z", true),
      disc("new", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false),
    );
    expect(findLatches(d).map((l) => l.discussionId)).toEqual(["new", "old"]);
  });

  test("breaks createdAt ties on discussion id", () => {
    const d = detail(
      disc("bbb", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false),
      disc("aaa", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false),
    );
    expect(findLatches(d).map((l) => l.discussionId)).toEqual(["bbb", "aaa"]);
  });
});

describe("canonicalLatch", () => {
  // The bug that would silently disable the feature per MR: a spent relic from
  // review cycle 1 must never outrank cycle 2's live latch.
  test("picks the newest, so a spent relic never beats a fresh latch", () => {
    const d = detail(
      disc("relic", spentLatchBody(IMG), "2026-08-01T10:00:00Z", true),
      disc("fresh", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false),
    );
    expect(canonicalLatch(findLatches(d))!.discussionId).toBe("fresh");
  });

  test("is null when there are no latches", () => {
    expect(canonicalLatch([])).toBeNull();
  });
});

describe("requestCarriers / hasRequest", () => {
  test("an armed resolved latch is a request", () => {
    const d = detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true));
    expect(hasRequest(findLatches(d))).toBe(true);
    expect(requestCarriers(findLatches(d)).map((l) => l.discussionId)).toEqual(["d1"]);
  });

  test("an armed unresolved latch is not a request", () => {
    const d = detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false));
    expect(hasRequest(findLatches(d))).toBe(false);
  });

  // The invariant: a spent latch is never a request, however it got resolved.
  test("a spent resolved latch is not a request", () => {
    const d = detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", true));
    expect(hasRequest(findLatches(d))).toBe(false);
    expect(requestCarriers(findLatches(d))).toEqual([]);
  });

  // Resolving the DUPLICATE is still asking; reading only the canonical latch
  // would eat the request with no reply.
  test("a resolved extra carries the request even when the canonical is not resolved", () => {
    const d = detail(
      disc("canon", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false),
      disc("extra", armedLatchBody(IMG), "2026-09-01T09:00:00Z", true),
    );
    const latches = findLatches(d);
    expect(canonicalLatch(latches)!.discussionId).toBe("canon");
    expect(hasRequest(latches)).toBe(true);
    expect(requestCarriers(latches).map((l) => l.discussionId)).toEqual(["extra"]);
  });

  test("both resolved means both carry, so both get consumed", () => {
    const d = detail(
      disc("canon", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true),
      disc("extra", armedLatchBody(IMG), "2026-09-01T09:00:00Z", true),
    );
    expect(requestCarriers(findLatches(d)).map((l) => l.discussionId)).toEqual([
      "canon",
      "extra",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/latch-discussions.test.ts
```

Expected: FAIL, cannot resolve `../latch/discussions.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/latch/discussions.ts`:

```ts
/**
 * Finding latches in an MR's discussions.
 *
 * Two rules carry the design. The canonical latch is the NEWEST, because spent
 * latches are never deleted while review state is per-MR and reused across
 * review cycles: oldest-wins would read a spent relic as canonical and destroy
 * every later cycle's latch. And a request is ANY armed latch that is
 * resolved, not just the canonical one, because an author who resolves a
 * duplicate is still asking.
 */
import type { MRDetail } from "@mattstack/glance";
import { latchKindOf, type LatchKind } from "./markers.ts";

export interface LatchRef {
  discussionId: string;
  /** The thread's first note, which is the one the spend rewrites. */
  rootNoteId: number;
  kind: LatchKind;
  resolved: boolean;
  createdAt: string;
  body: string;
}

/** Every latch on the MR, newest first. glance's Discussion has no timestamp
    of its own, so ordering comes from the root note's createdAt, which GitLab
    leaves untouched when the spend edits the body. */
export function findLatches(detail: MRDetail): LatchRef[] {
  const out: LatchRef[] = [];
  for (const d of detail.discussions) {
    const root = d.notes[0];
    if (!root) continue;
    const kind = latchKindOf(root.body ?? "");
    if (!kind) continue;
    out.push({
      discussionId: d.id,
      rootNoteId: root.id,
      kind,
      resolved: !!d.resolved,
      createdAt: root.createdAt,
      body: root.body ?? "",
    });
  }
  return out.sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.discussionId.localeCompare(a.discussionId),
  );
}

export function canonicalLatch(latches: LatchRef[]): LatchRef | null {
  return latches[0] ?? null;
}

/** Every latch holding an unconsumed request. Disposing of a request must
    spend all of these, or the request bit survives in an extra and re-fires on
    every re-entry into scope. */
export function requestCarriers(latches: LatchRef[]): LatchRef[] {
  return latches.filter((l) => l.kind === "armed" && l.resolved);
}

export function hasRequest(latches: LatchRef[]): boolean {
  return requestCarriers(latches).length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/latch-discussions.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/latch/discussions.ts src/__tests__/latch-discussions.test.ts
git commit -m "add src/latch/discussions.ts: newest-wins latch discovery"
```

---

## Task 7: Exclude latches from the board's comment signals

Without this, the board's own thread inflates "N comments", and an armed latch makes an MR with no outstanding feedback read as commented.

**Files:**
- Modify: `src/discussions.ts`
- Test: `src/__tests__/discussions.test.ts`

**Interfaces:**
- Consumes: `latchKindOf` from Task 4.
- Produces: no new exports. `summarizeDiscussions` drops latch threads from both `threads` and `comments`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/discussions.test.ts`, using the helpers that file already defines: `note(username, opts)` at line 5 and `detail(discussions)` at line 19, which takes a single array of `{ notes }`. Do not introduce a second `detail`.

```ts
describe("latch exclusion", () => {
  const AUTHOR = "dorothy";
  const IMG = "![re-review latch](/uploads/ab12/latch.png)";

  test("an armed latch is not counted as a reviewer thread", () => {
    const d = detail([
      { notes: [note("reviewer", { body: "please fix" })] },
      { notes: [note("reviewer", { body: armedLatchBody(IMG) })] },
    ]);
    const { threads } = summarizeDiscussions(d, AUTHOR);
    expect(threads).toHaveLength(1);
    expect(unresolvedReviewerCount(threads)).toBe(1);
  });

  // A spent latch is a RESOLVED thread, so without the exclusion it lands in
  // threadSummary.resolved, which commentsAllResolved reads as a signal.
  test("a spent latch is not counted as a resolved thread", () => {
    const d = detail([
      { notes: [note("reviewer", { body: spentLatchBody(IMG), resolved: true })] },
    ]);
    const { threads } = summarizeDiscussions(d, AUTHOR);
    expect(threads).toHaveLength(0);
  });

  test("a latch is not counted as a general comment either", () => {
    const d = detail([
      { notes: [note("reviewer", { body: armedLatchBody(IMG), resolvable: false })] },
    ]);
    const { comments } = summarizeDiscussions(d, AUTHOR);
    expect(comments).toHaveLength(0);
  });
});
```

The only import this block adds is the markers module; `summarizeDiscussions` and `unresolvedReviewerCount` are already imported at line 3:

```ts
import { armedLatchBody, spentLatchBody } from "../latch/markers.ts";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/discussions.test.ts
```

Expected: FAIL, the latch is counted as a thread.

- [ ] **Step 3: Write minimal implementation**

In `src/discussions.ts`, import the classifier:

```ts
import { latchKindOf } from "./latch/markers.ts";
```

Inside `summarizeDiscussions`'s loop over `detail.discussions`, immediately after the existing `if (!notes.length) continue;`, add:

```ts
    // The board's own latch thread is machinery, not feedback. Counting it
    // would inflate "N comments", and a spent latch is a resolved thread, so
    // it would also feed threadSummary.resolved and make an MR with no real
    // feedback read as all-resolved.
    if (latchKindOf(notes[0]!.body ?? "")) continue;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/discussions.test.ts
```

Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add src/discussions.ts src/__tests__/discussions.test.ts
git commit -m "discussions: exclude latch threads from comment signals"
```

---

## Task 8: Source-tagged re-review decisions

`decideNudge` becomes the single judge for both sources. The freshness rule is skipped for latch requests, which cannot go stale because the pass consumes them on the next tick.

**Files:**
- Modify: `src/triage/nudge.ts:20-36`
- Test: `src/__tests__/triage-nudge.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type ReReviewSource = "nudge" | "latch"`
  - `interface ReReviewRequest { mrUrl: string; iid: number; source: ReReviewSource; receivedAt: number | null; handled: boolean }`
  - `decideRequest(req: ReReviewRequest, ownReview: ReviewState | undefined, m: MrMemory, cfg: TriageConfig, now: number): NudgeDecision`
  - `decideNudge` keeps its existing signature as a thin adapter, so `runNudgePass` and its tests are untouched.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/triage-nudge.test.ts`:

```ts
describe("decideRequest", () => {
  const latchReq: ReReviewRequest = {
    mrUrl: nudge.mrUrl,
    iid: 1,
    source: "latch",
    receivedAt: null,
    handled: false,
  };

  test("a latch request dispatches on a commented review", () => {
    expect(decideRequest(latchReq, commentedReview, m, cfg, NOW)).toEqual({
      action: "dispatch",
      reason: "latch",
    });
  });

  // A latch cannot go stale: the pass consumes it on the tick after it is
  // resolved, so there is no queue to age and no receivedAt to judge.
  test("a latch request never expires, however old the MR is", () => {
    const wayLater = NOW + NUDGE_FRESH_MS * 100;
    expect(decideRequest(latchReq, commentedReview, m, cfg, wayLater).action).toBe("dispatch");
  });

  test("a latch request still respects an in-flight review", () => {
    const inFlight: ReviewState = { ...commentedReview, status: "reviewing" };
    expect(decideRequest(latchReq, inFlight, m, cfg, NOW)).toEqual({
      action: "reject",
      reason: "review-in-flight",
    });
  });

  test("a latch request still respects the cooldown", () => {
    const hot: MrMemory = { ...m, lastDispatchAt: NOW - 60_000 };
    expect(decideRequest(latchReq, commentedReview, hot, cfg, NOW)).toEqual({
      action: "reject",
      reason: "cooldown",
    });
  });

  test("a latch request still respects the daily budget", () => {
    const spent: MrMemory = { ...m, attemptsToday: cfg.dailyAttemptBudget };
    expect(decideRequest(latchReq, commentedReview, spent, cfg, NOW)).toEqual({
      action: "reject",
      reason: "budget-exhausted",
    });
  });

  // The nudge path keeps expiring, so the skip must be scoped to source.
  test("a nudge request with a stale receivedAt still expires", () => {
    const stale: ReReviewRequest = {
      ...latchReq,
      source: "nudge",
      receivedAt: NOW - NUDGE_FRESH_MS - 1,
    };
    expect(decideRequest(stale, commentedReview, m, cfg, NOW)).toEqual({
      action: "expire",
      reason: "stale",
    });
  });
});
```

Extend the file's existing import from `../triage/nudge.ts` to add `decideRequest` and `type ReReviewRequest`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/triage-nudge.test.ts
```

Expected: FAIL, `decideRequest` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/triage/nudge.ts`, replace the `decideNudge` function with:

```ts
export type ReReviewSource = "nudge" | "latch";

/** A re-review request from either source, as the decision function sees it.
    `receivedAt` is null for a latch: a latch cannot go stale, because the pass
    consumes it on the tick after it is resolved, so there is no queue to age. */
export interface ReReviewRequest {
  mrUrl: string;
  iid: number;
  source: ReReviewSource;
  receivedAt: number | null;
  handled: boolean;
}

/** The whole re-review guardrail, one pure function, shared by both sources.
    Freshness is judged on the relay-stamped receivedAt (never sender-clock
    sentAt) and only when there is one. Reject (vs skip) is terminal: it
    publishes an outcome so the requester's chip resolves, and the requester can
    re-request once the blocker clears. */
export function decideRequest(
  req: ReReviewRequest,
  ownReview: ReviewState | undefined,
  m: MrMemory,
  cfg: TriageConfig,
  now: number,
): NudgeDecision {
  if (req.handled) return { action: "skip", reason: "already-handled" };
  if (!cfg.enabled) return { action: "skip", reason: "disabled" };
  if (req.receivedAt !== null && now - req.receivedAt > NUDGE_FRESH_MS) {
    return { action: "expire", reason: "stale" };
  }
  if (ownReview && (ownReview.status === "queued" || ownReview.status === "reviewing")) {
    return { action: "reject", reason: "review-in-flight" };
  }
  if (!ownReview || ownReview.status !== "done" || ownReview.outcome !== "comment") {
    return { action: "reject", reason: "no-commented-review" };
  }
  if (m.attemptsToday >= cfg.dailyAttemptBudget) return { action: "reject", reason: "budget-exhausted" };
  if (m.lastDispatchAt !== null && now - m.lastDispatchAt < cfg.cooldownMinutes * 60_000) {
    return { action: "reject", reason: "cooldown" };
  }
  return { action: "dispatch", reason: req.source };
}

/** Adapter for the peer-nudge source, so runNudgePass and its callers keep
    their existing shape. */
export function decideNudge(
  nudge: NudgeState,
  ownReview: ReviewState | undefined,
  m: MrMemory,
  cfg: TriageConfig,
  now: number,
): NudgeDecision {
  return decideRequest(
    {
      mrUrl: nudge.mrUrl,
      iid: nudge.iid,
      source: "nudge",
      receivedAt: nudge.receivedAt,
      handled: !!nudge.handled,
    },
    ownReview,
    m,
    cfg,
    now,
  );
}
```

- [ ] **Step 4: Run the whole triage suite to verify nothing regressed**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/triage-nudge.test.ts && bun run typecheck
```

Expected: PASS, both the new `decideRequest` block and every pre-existing `decideNudge` case. One pre-existing expectation may now read `reason: "nudge"` where it read `"nudge"` before; it should be unchanged, since the adapter passes `source: "nudge"`.

- [ ] **Step 5: Commit**

```bash
git add src/triage/nudge.ts src/__tests__/triage-nudge.test.ts
git commit -m "triage: source-tagged re-review decisions, no expiry for latches"
```

---

## Task 9: Post and spend the latch from the server

**Files:**
- Create: `src/latch/post.ts`
- Create: `src/latch/gateway.ts`
- Modify: `src/server.ts` (the `/agent/status` case, near line 959)
- Test: `src/__tests__/latch-post.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2 (glance), 4 (markers), 5 (banner), 6 (discovery).
- Produces:
  - `interface LatchGateway { uploadFile(...); createDiscussion(...); updateNote(...); resolveDiscussion(...); unresolveDiscussion(...); createNote(...) }`
  - `postLatch(gw: LatchGateway, projectId: number, projectPath: string, mrUrl: string, iid: number): Promise<void>`
  - `spendLatch(gw: LatchGateway, projectId: number, projectPath: string, iid: number, latch: LatchRef): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/latch-post.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { latchKindOf } from "../latch/markers.ts";
import { postLatch, spendLatch, type LatchGateway } from "../latch/post.ts";
import type { LatchRef } from "../latch/discussions.ts";

const MR = "https://gitlab.com/acme/web/-/merge_requests/2317";
const IMG = "![re-review latch](/uploads/ab12/latch-2317.png)";

function gateway() {
  const calls: string[] = [];
  const bodies: string[] = [];
  const gw: LatchGateway = {
    async uploadFile(_p, filename) {
      calls.push(`upload:${filename}`);
      return { alt: "latch", url: "/uploads/ab12/latch-2317.png", full_path: "x", markdown: IMG };
    },
    async createDiscussion(_p, _iid, body) {
      calls.push("createDiscussion");
      bodies.push(body);
      return { id: "d1", notes: [{ id: 1 } as never] };
    },
    async updateNote(_p, _iid, noteId, body) {
      calls.push(`updateNote:${noteId}`);
      bodies.push(body);
    },
    async resolveDiscussion(_path, _iid, id) {
      calls.push(`resolve:${id}`);
    },
    async unresolveDiscussion(_path, _iid, id) {
      calls.push(`unresolve:${id}`);
    },
    async createNote(_p, _iid, body) {
      calls.push("createNote");
      bodies.push(body);
      return { id: 9 } as never;
    },
  };
  return { gw, calls, bodies };
}

describe("postLatch", () => {
  test("uploads the banner then creates a resolvable discussion", async () => {
    const { gw, calls, bodies } = gateway();
    await postLatch(gw, 42, "acme/web", MR, 2317);
    expect(calls).toEqual(["upload:latch-2317.png", "createDiscussion"]);
    expect(latchKindOf(bodies[0]!)).toBe("armed");
    expect(bodies[0]).toContain(IMG);
  });
});

describe("spendLatch", () => {
  const armed: LatchRef = {
    discussionId: "d1",
    rootNoteId: 1,
    kind: "armed",
    resolved: true,
    createdAt: "2026-09-01T10:00:00Z",
    body: `<!-- mattstack:board re-review-latch v1 -->\n\n${IMG}\n\nbody`,
  };

  // Rewrite BEFORE resolve. A crash between them leaves a spent-but-unresolved
  // latch, which the pass repairs. The reverse leaves a resolved-but-unspent
  // latch, which is indistinguishable from a human request.
  test("rewrites the body before resolving", async () => {
    const { gw, calls, bodies } = gateway();
    await spendLatch(gw, 42, "acme/web", 2317, armed);
    expect(calls).toEqual(["updateNote:1", "resolve:d1"]);
    expect(latchKindOf(bodies[0]!)).toBe("spent");
  });

  // The banner is already uploaded; spending must not upload it again.
  test("reuses the uploaded banner instead of re-uploading", async () => {
    const { gw, calls, bodies } = gateway();
    await spendLatch(gw, 42, "acme/web", 2317, armed);
    expect(calls.some((c) => c.startsWith("upload:"))).toBe(false);
    expect(bodies[0]).toContain(IMG);
  });

  test("an already-spent latch that is resolved draws no writes", async () => {
    const { gw, calls } = gateway();
    await spendLatch(gw, 42, "acme/web", 2317, { ...armed, kind: "spent", resolved: true });
    expect(calls).toEqual([]);
  });

  // The crash-repair path: body already spent, thread still open.
  test("an already-spent latch that is unresolved is only re-resolved", async () => {
    const { gw, calls } = gateway();
    await spendLatch(gw, 42, "acme/web", 2317, { ...armed, kind: "spent", resolved: false });
    expect(calls).toEqual(["resolve:d1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/latch-post.test.ts
```

Expected: FAIL, cannot resolve `../latch/post.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/latch/post.ts`:

```ts
/**
 * The latch's GitLab writes, behind one injected gateway so the pass and the
 * server share them and tests need no network.
 */
import { latchBannerPng } from "./banner.ts";
import { armedLatchBody, imageMarkdownOf, spentLatchBody } from "./markers.ts";
import type { LatchRef } from "./discussions.ts";

export interface LatchGateway {
  uploadFile(
    projectId: number,
    filename: string,
    bytes: Uint8Array,
    contentType?: string,
  ): Promise<{ markdown: string; url: string; alt: string; full_path: string }>;
  createDiscussion(
    projectId: number,
    mrIid: number,
    body: string,
  ): Promise<{ id: string; notes: { id: number }[] }>;
  updateNote(projectId: number, mrIid: number, noteId: number, body: string): Promise<void>;
  resolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void>;
  unresolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void>;
  createNote(
    projectId: number,
    mrIid: number,
    body: string,
    discussionId?: string,
  ): Promise<{ id: number }>;
}

/** Arm a fresh latch: upload this MR's banner, then open a resolvable thread. */
export async function postLatch(
  gw: LatchGateway,
  projectId: number,
  _projectPath: string,
  mrUrl: string,
  iid: number,
): Promise<void> {
  const png = latchBannerPng(mrUrl);
  const up = await gw.uploadFile(projectId, `latch-${iid}.png`, png, "image/png");
  await gw.createDiscussion(projectId, iid, armedLatchBody(up.markdown));
}

/**
 * Terminal disposal: rewrite the body to the spent form, then resolve.
 *
 * Ordered rewrite-first deliberately. A crash between the two calls leaves a
 * spent-but-unresolved latch, which the pass repairs by re-resolving. The
 * reverse order leaves a resolved-but-unspent latch, which reads as a human
 * request and costs a dispatch nobody asked for.
 */
export async function spendLatch(
  gw: LatchGateway,
  projectId: number,
  projectPath: string,
  iid: number,
  latch: LatchRef,
  rootNoteId: number = latch.rootNoteId,
): Promise<void> {
  if (latch.kind === "spent") {
    // Idempotent: an already-spent latch is left alone, except for the crash
    // residue where the body was written but the resolve never landed.
    if (!latch.resolved) await gw.resolveDiscussion(projectPath, iid, latch.discussionId);
    return;
  }
  const img = imageMarkdownOf(latch.body);
  const body = spentLatchBody(img ?? "");
  await gw.updateNote(projectId, iid, rootNoteId, body);
  await gw.resolveDiscussion(projectPath, iid, latch.discussionId);
}
```

`spendLatch` takes `rootNoteId` separately rather than reading `latch.rootNoteId`, so a caller can override it; every caller in this plan passes `latch.rootNoteId`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/latch-post.test.ts src/__tests__/latch-discussions.test.ts
```

Expected: PASS, both files.

- [ ] **Step 5: Wire the server's `/agent/status` handler**

In `src/server.ts`, find the `/agent/status` case (near line 959). Insert the latch step **after the peer-sync block closes (near line 1003) and before `const emoji = signalEmoji(...)`**. That position matters: the `signalEmoji` block early-returns when there is no emoji for the transition, and returns 400 when Slack is unconfigured, so anything appended below it is skipped on a Slack-less install.

```ts
        // Arm a latch when a review lands with a comment outcome, spend it when
        // one lands approved. Best-effort, like every other side effect here:
        // the triage latch pass reconciles anything a down or throwing board
        // misses, so a failure must never fail the agent's status write.
        if (signal.kind === "review" && signal.status === "done" && gitlabToken) {
          try {
            const snapshot = await cache.get();
            const mr = snapshot.mrs.find((m) => m.webUrl === signal.mrUrl);
            if (mr) {
              const projectId = parseRepoId(mr.repositoryId);
              const projectPath = projectPathFromWebUrl(signal.mrUrl, config.gitlabHost) ?? "";
              const gw = latchGateway(config.gitlabHost, gitlabToken);
              if (signal.outcome === "comment") {
                const detail = await readLatchDetail(mr);
                if (detail && !canonicalLatch(findLatches(detail))) {
                  await postLatch(gw, projectId, projectPath, signal.mrUrl, mr.iid);
                }
              } else if (signal.outcome === "approve") {
                const detail = await readLatchDetail(mr);
                const latch = detail ? canonicalLatch(findLatches(detail)) : null;
                if (latch) await spendLatch(gw, projectId, projectPath, mr.iid, latch, latch.rootNoteId);
              }
            }
          } catch (err) {
            console.error(`latch step failed for ${signal.mrUrl}: ${err}`);
          }
        }
```

Create `src/latch/gateway.ts`, so the server and the triage pass build the gateway the same way and cannot drift:

```ts
import { GitLabProvider, NoteMutator } from "@mattstack/glance";
import type { LatchGateway } from "./post.ts";

/** The latch's GitLab writes, bound to one board's host and token. */
export function latchGateway(host: string, token: string): LatchGateway {
  const mutator = new NoteMutator(host, token);
  const provider = new GitLabProvider(host, token);
  return {
    uploadFile: (p, f, b, ct) => mutator.uploadFile(p, f, b, ct),
    createDiscussion: (p, iid, body) => mutator.createDiscussion(p, iid, body),
    updateNote: (p, iid, noteId, body) => mutator.updateNote(p, iid, noteId, body),
    resolveDiscussion: (path, iid, id) => provider.resolveDiscussion(path, iid, id),
    unresolveDiscussion: (path, iid, id) => provider.unresolveDiscussion(path, iid, id),
    createNote: (p, iid, body, discussionId) => mutator.createNote(p, iid, body, discussionId),
  };
}
```

Add one helper near `server.ts`'s other module-level helpers:

```ts
/** This MR's discussions, from the daemon store the snapshot refresh uses. */
async function readLatchDetail(mr: BoardMR): Promise<MRDetail | null> {
  if (!mr.rtRepo) return null;
  const repoId = repoIdentityField(mr.rtRepo);
  if (!repoId) return null;
  const res = await readDiscussions(repoId, mr.iid);
  if (!res.ok || !res.data) return null;
  return { discussions: res.data.discussions } as MRDetail;
}
```

Add the imports:

```ts
import { canonicalLatch, findLatches } from "./latch/discussions.ts";
import { latchGateway } from "./latch/gateway.ts";
import { postLatch, spendLatch } from "./latch/post.ts";
```

- [ ] **Step 6: Typecheck**

```bash
cd ~/Documents/GitHub/board && bun run typecheck && bun test
```

Expected: clean typecheck, full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/latch/post.ts src/latch/gateway.ts src/server.ts src/__tests__/latch-post.test.ts
git commit -m "server: arm the latch on a comment review, spend it on approve"
```

---

## Task 10: `runLatchPass`

The ordered branch list. Every rule the spec's review rounds established lives here.

**Files:**
- Create: `src/triage/latch.ts`
- Test: `src/__tests__/triage-latch.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 6, 8, 9.
- Produces: `runLatchPass(deps: LatchPassDeps): Promise<LatchPassResult>` with

```ts
export interface LatchMrFacts {
  mrUrl: string;
  iid: number;
  projectId: number;
  projectPath: string;
  /** The rt repo name this MR's discussions are read from. Carried per MR
      because a board can watch several projects. */
  rtRepo: string;
  isApproved: boolean;
}
export interface LatchPassDeps {
  readReviewStates(): Map<string, ReviewState>;
  fetchLatchMrs(): Promise<LatchMrFacts[]>;
  readDetail(mr: LatchMrFacts): Promise<MRDetail | null>;
  gateway: LatchGateway;
  launchReReview(mrUrl: string, iid: number): Promise<ReReviewLaunch>;
  memory: DispatchMemory;
  cfg: TriageConfig;
  appendAudit(entry: AuditEntry): void;
  notify(title: string, message: string): Promise<void>;
  now(): number;
}
export interface LatchPassResult {
  posted: number; dispatched: number; rejected: number;
  spent: number; repaired: number; skipped: number;
}
```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/triage-latch.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { MRDetail } from "@mattstack/glance";
import { parseTriageBlock } from "../triage/config.ts";
import { emptyMrMemory, type DispatchMemory } from "../triage/memory.ts";
import { armedLatchBody, spentLatchBody } from "../latch/markers.ts";
import type { LatchGateway } from "../latch/post.ts";
import type { ReviewState } from "../review-state.ts";
import { runLatchPass, type LatchMrFacts, type LatchPassDeps } from "../triage/latch.ts";

const NOW = 1_000_000_000;
const MR = "https://gitlab.com/acme/web/-/merge_requests/2317";
const IMG = "![re-review latch](/uploads/ab12/latch-2317.png)";
const cfg = parseTriageBlock({ enabled: true, cooldownMinutes: 30, dailyAttemptBudget: 3 });

const facts: LatchMrFacts = {
  mrUrl: MR, iid: 2317, projectId: 42, projectPath: "acme/web",
  rtRepo: "acme-web", isApproved: false,
};
const commented: ReviewState = {
  mrUrl: MR, iid: 2317, status: "done", outcome: "comment", startedAt: 0, updatedAt: 0,
};

function disc(id: string, body: string, createdAt: string, resolved: boolean) {
  return {
    id, resolvable: true, resolved,
    notes: [{
      id: 1, body, author: { id: 1, username: "matt", name: "Matt", avatarUrl: null },
      createdAt, system: false, type: "DiscussionNote", resolvable: true, resolved, position: null,
    }],
  };
}
const detail = (...d: ReturnType<typeof disc>[]) =>
  ({ mrIid: 2317, repositoryId: "gitlab:42", discussions: d } as unknown as MRDetail);

function harness(over: Partial<LatchPassDeps> & { detail?: MRDetail | null } = {}) {
  const calls: string[] = [];
  const launches: string[] = [];
  const gateway: LatchGateway = {
    async uploadFile() { calls.push("upload"); return { alt: "", url: "", full_path: "", markdown: IMG }; },
    async createDiscussion() { calls.push("createDiscussion"); return { id: "new", notes: [{ id: 1 }] }; },
    async updateNote(_p, _i, id) { calls.push(`updateNote:${id}`); },
    async resolveDiscussion(_p, _i, id) { calls.push(`resolve:${id}`); },
    async unresolveDiscussion(_p, _i, id) { calls.push(`unresolve:${id}`); },
    async createNote(_p, _i, _b, d) { calls.push(`reply:${d}`); return { id: 9 }; },
  };
  const memory: DispatchMemory = { identity: null, mrs: {} };
  const deps: LatchPassDeps = {
    readReviewStates: () => new Map([[MR, commented]]),
    fetchLatchMrs: async () => [facts],
    readDetail: async () => (over.detail === undefined ? detail() : over.detail),
    gateway,
    launchReReview: async (u) => { launches.push(u); return { kind: "launched" }; },
    memory, cfg, appendAudit: () => {}, notify: async () => {}, now: () => NOW,
    ...over,
  };
  return { deps, calls, launches, memory };
}

describe("step 0: no latch", () => {
  test("posts one on a comment-outcome state", async () => {
    const { deps, calls } = harness({ detail: detail() });
    const r = await runLatchPass(deps);
    expect(r.posted).toBe(1);
    expect(calls).toEqual(["upload", "createDiscussion"]);
  });

  test("posts nothing on an approve-outcome state", async () => {
    const approved: ReviewState = { ...commented, outcome: "approve" };
    const { deps, calls } = harness({
      detail: detail(), readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).posted).toBe(0);
    expect(calls).toEqual([]);
  });

  // Descoped: a spent relic with no live latch is left alone. Arming a second
  // cycle is the server's job.
  test("posts nothing when a spent relic exists but no live latch", async () => {
    const { deps, calls } = harness({
      detail: detail(disc("relic", spentLatchBody(IMG), "2026-08-01T10:00:00Z", true)),
    });
    expect((await runLatchPass(deps)).posted).toBe(0);
    expect(calls).toEqual([]);
  });

  test("ignores a done state with no outcome at all", async () => {
    const noOutcome: ReviewState = { ...commented, outcome: undefined };
    const { deps, calls } = harness({
      detail: detail(), readReviewStates: () => new Map([[MR, noOutcome]]),
    });
    expect((await runLatchPass(deps)).skipped).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe("step 1: spent latch", () => {
  test("a spent resolved latch draws no writes and never dispatches", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", true)),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
    expect(launches).toEqual([]);
  });

  test("a spent unresolved latch is re-resolved, never rearmed", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", false)),
    });
    expect((await runLatchPass(deps)).repaired).toBe(1);
    expect(calls).toEqual(["resolve:d1"]);
    expect(launches).toEqual([]);
  });

  // Revoked approval must not resurrect a spent latch.
  test("a spent latch on an unapproved MR is still left alone", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", true)),
      fetchLatchMrs: async () => [{ ...facts, isApproved: false }],
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
    expect(launches).toEqual([]);
  });
});

describe("step 2: armed and unresolved", () => {
  test("does nothing on a comment-outcome state", async () => {
    const { deps, calls } = harness({
      detail: detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false)),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
  });

  test("spends on an approve-outcome state, completing a missed server spend", async () => {
    const approved: ReviewState = { ...commented, outcome: "approve" };
    const { deps, calls } = harness({
      detail: detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false)),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(calls).toEqual(["updateNote:1", "resolve:d1"]);
  });
});

describe("step 3: armed and resolved", () => {
  test("dispatches, replies, and unresolves to rearm", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true)),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(["reply:d1", "unresolve:d1"]);
  });

  test("an approved MR spends instead of dispatching", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true)),
      fetchLatchMrs: async () => [{ ...facts, isApproved: true }],
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual(["updateNote:1", "resolve:d1"]);
  });

  test("a refusal replies with the reason and still unresolves", async () => {
    const memory: DispatchMemory = {
      identity: null,
      mrs: { [MR]: { ...emptyMrMemory("1970-01-12"), lastDispatchAt: NOW - 60_000 } },
    };
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true)),
      memory,
    });
    expect((await runLatchPass(deps)).rejected).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual(["reply:d1", "unresolve:d1"]);
  });
});

describe("idempotence across ticks", () => {
  // The write-loop the design eliminated: a spent latch must draw no writes on
  // any later tick, not merely on the tick that spent it.
  test("a second tick over an already-spent latch writes nothing", async () => {
    const spentDetail = detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", true));
    const { deps, calls } = harness({ detail: spentDetail });
    await runLatchPass(deps);
    await runLatchPass(deps);
    expect(calls).toEqual([]);
  });

  test("an approve-outcome state repairs a spent-but-unresolved latch once", async () => {
    const approved: ReviewState = { ...commented, outcome: "approve" };
    const { deps, calls } = harness({
      detail: detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", false)),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).repaired).toBe(1);
    expect(calls).toEqual(["resolve:d1"]);
  });
});

describe("dedupe", () => {
  // A spent relic must never outrank a fresh latch, or the feature silently
  // disables itself on this MR forever.
  test("a fresh latch beats a spent relic", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc("relic", spentLatchBody(IMG), "2026-08-01T10:00:00Z", true),
        disc("fresh", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true),
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(["reply:fresh", "unresolve:fresh", "updateNote:1", "resolve:relic"]
      .filter((c) => !c.startsWith("updateNote") && !c.startsWith("resolve:relic")));
  });

  // Resolving the duplicate is still asking, and the request must be consumed
  // in BOTH copies or it re-fires on every re-entry into scope.
  test("a resolved extra triggers the request and is spent by the disposal", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc("canon", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false),
        disc("extra", armedLatchBody(IMG), "2026-09-01T09:00:00Z", true),
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toContain("reply:canon");
    expect(calls).toContain("updateNote:1");
    expect(calls).toContain("resolve:extra");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/triage-latch.test.ts
```

Expected: FAIL, cannot resolve `../triage/latch.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/triage/latch.ts`:

```ts
/**
 * The latch pass: read every done review state's MR, and act on the latch.
 *
 * Branch order is the design's safety property, not a style choice. The spent
 * check is unconditional and runs first, so no board-made resolve can ever be
 * read back as a human request, whatever the MR's approval state does
 * afterwards.
 */
import type { MRDetail } from "@mattstack/glance";
import { canonicalLatch, findLatches, requestCarriers, type LatchRef } from "../latch/discussions.ts";
import { postLatch, spendLatch, type LatchGateway } from "../latch/post.ts";
import type { ReviewState } from "../review-state.ts";
import type { ReReviewLaunch } from "../review-launch.ts";
import type { AuditEntry } from "./audit.ts";
import type { TriageConfig } from "./config.ts";
import { decideRequest } from "./nudge.ts";
import { emptyMrMemory, rollDay, type DispatchMemory } from "./memory.ts";

export interface LatchMrFacts {
  mrUrl: string;
  iid: number;
  projectId: number;
  projectPath: string;
  /** The rt repo name this MR's discussions are read from. Carried per MR
      because a board can watch several projects. */
  rtRepo: string;
  isApproved: boolean;
}

export interface LatchPassDeps {
  readReviewStates(): Map<string, ReviewState>;
  fetchLatchMrs(): Promise<LatchMrFacts[]>;
  readDetail(mr: LatchMrFacts): Promise<MRDetail | null>;
  gateway: LatchGateway;
  launchReReview(mrUrl: string, iid: number): Promise<ReReviewLaunch>;
  memory: DispatchMemory;
  cfg: TriageConfig;
  appendAudit(entry: AuditEntry): void;
  notify(title: string, message: string): Promise<void>;
  now(): number;
}

export interface LatchPassResult {
  posted: number;
  dispatched: number;
  rejected: number;
  spent: number;
  repaired: number;
  skipped: number;
}

const DISPATCH_REPLY = "Re-review started. I'll comment again when the pass is done, and this latch is armed for next time.";
const refusalReply = (reason: string) =>
  `Not yet: ${reason}. Resolve this thread again once that clears and I'll pick it up.`;

export async function runLatchPass(deps: LatchPassDeps): Promise<LatchPassResult> {
  const result: LatchPassResult = { posted: 0, dispatched: 0, rejected: 0, spent: 0, repaired: 0, skipped: 0 };
  if (!deps.cfg.enabled) return result;

  const reviews = deps.readReviewStates();
  const now = deps.now();
  const dayStamp = new Date(now).toISOString().slice(0, 10);
  const mrs = await deps.fetchLatchMrs();

  for (const mr of mrs) {
    const review = reviews.get(mr.mrUrl);
    // A done state with no outcome records no verdict, so there is nothing to
    // arm and nothing to spend. decideRequest treats it the same way.
    if (!review || review.status !== "done" || !review.outcome) {
      result.skipped++;
      continue;
    }
    const detail = await deps.readDetail(mr);
    if (!detail) {
      result.skipped++;
      continue;
    }
    const latches = findLatches(detail);
    const canon = canonicalLatch(latches);

    // Step 0: nothing to act on. A spent relic with no live latch is the
    // descoped case: arming a second review cycle is the server's job.
    if (!canon) {
      if (review.outcome === "comment") {
        await postLatch(deps.gateway, mr.projectId, mr.projectPath, mr.mrUrl, mr.iid);
        deps.appendAudit({ ts: now, mrUrl: mr.mrUrl, iid: mr.iid, event: "latch", action: "posted" });
        result.posted++;
      } else {
        result.skipped++;
      }
      continue;
    }

    // Step 1: spent wins over everything, unconditionally.
    if (canon.kind === "spent") {
      if (!canon.resolved) {
        await spendLatch(deps.gateway, mr.projectId, mr.projectPath, mr.iid, canon);
        deps.appendAudit({ ts: now, mrUrl: mr.mrUrl, iid: mr.iid, event: "latch", action: "repaired" });
        result.repaired++;
      } else {
        result.skipped++;
      }
      continue;
    }

    const carriers = requestCarriers(latches);

    // Step 2: armed and nobody has asked.
    if (carriers.length === 0) {
      if (review.outcome === "approve") {
        await spendLatch(deps.gateway, mr.projectId, mr.projectPath, mr.iid, canon);
        deps.appendAudit({ ts: now, mrUrl: mr.mrUrl, iid: mr.iid, event: "latch", action: "spent" });
        result.spent++;
      } else {
        result.skipped++;
      }
      continue;
    }

    // Step 3: a human resolved a latch. An approved MR spends rather than
    // dispatching, whichever direction the approval came from.
    if (mr.isApproved || review.outcome === "approve") {
      await spendAll(deps, mr, [canon, ...carriers]);
      deps.appendAudit({ ts: now, mrUrl: mr.mrUrl, iid: mr.iid, event: "latch", action: "spent" });
      result.spent++;
      continue;
    }

    const m = rollDay(deps.memory.mrs[mr.mrUrl] ?? emptyMrMemory(dayStamp), dayStamp);
    deps.memory.mrs[mr.mrUrl] = m;
    const decision = decideRequest(
      { mrUrl: mr.mrUrl, iid: mr.iid, source: "latch", receivedAt: null, handled: false },
      review,
      m,
      deps.cfg,
      now,
    );
    deps.appendAudit({
      ts: now, mrUrl: mr.mrUrl, iid: mr.iid, event: "latch",
      decision: decision.action, reason: decision.reason, attempt: m.attemptsToday + 1,
    });

    if (decision.action !== "dispatch") {
      await deps.gateway.createNote(mr.projectId, mr.iid, refusalReply(decision.reason), canon.discussionId);
      await consume(deps, mr, canon, carriers);
      await deps.notify(`re-review held off on !${mr.iid}`, decision.reason);
      result.rejected++;
      continue;
    }

    const launch = await deps.launchReReview(mr.mrUrl, mr.iid);
    if (launch.kind === "error") {
      await deps.gateway.createNote(mr.projectId, mr.iid, refusalReply("the pane failed to start"), canon.discussionId);
      await consume(deps, mr, canon, carriers);
      deps.appendAudit({ ts: now, mrUrl: mr.mrUrl, iid: mr.iid, event: "latch", action: "launch-failed", outcome: launch.message });
      result.rejected++;
      continue;
    }

    await deps.gateway.createNote(mr.projectId, mr.iid, DISPATCH_REPLY, canon.discussionId);
    await consume(deps, mr, canon, carriers);
    m.lastDispatchAt = now;
    m.attemptsToday++;
    await deps.notify(`re-review launched on !${mr.iid}`, "requested from the MR");
    result.dispatched++;
  }
  return result;
}

/** Rearm the canonical latch and spend every OTHER copy carrying the request.
    Consuming the extras is what stops the request bit re-firing on the next
    re-entry into scope. */
async function consume(
  deps: LatchPassDeps,
  mr: LatchMrFacts,
  canon: LatchRef,
  carriers: LatchRef[],
): Promise<void> {
  if (canon.resolved) {
    await deps.gateway.unresolveDiscussion(mr.projectPath, mr.iid, canon.discussionId);
  }
  for (const c of carriers) {
    if (c.discussionId === canon.discussionId) continue;
    await spendLatch(deps.gateway, mr.projectId, mr.projectPath, mr.iid, c);
  }
}

/** Terminal disposal of every latch copy on an approved MR. */
async function spendAll(deps: LatchPassDeps, mr: LatchMrFacts, latches: LatchRef[]): Promise<void> {
  const seen = new Set<string>();
  for (const l of latches) {
    if (seen.has(l.discussionId)) continue;
    seen.add(l.discussionId);
    await spendLatch(deps.gateway, mr.projectId, mr.projectPath, mr.iid, l);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/board && bun test src/__tests__/triage-latch.test.ts
```

Expected: PASS, 16 tests. If the dedupe test's `calls` assertion is awkward, replace the filtered `toEqual` with explicit `toContain` assertions; the behaviour under test is that `fresh` is dispatched against and `relic` is untouched.

- [ ] **Step 5: Commit**

```bash
git add src/triage/latch.ts src/__tests__/triage-latch.test.ts
git commit -m "add src/triage/latch.ts: the ordered latch pass"
```

---

## Task 11: Wire the pass into triage

**Files:**
- Modify: `bin/triage.ts` (after the `runNudgePass` block near line 156)

**Interfaces:**
- Consumes: Tasks 9 and 10.
- Produces: nothing new; `bun run triage` now runs both passes under the same lock.

- [ ] **Step 1: Build the MR-facts fetch**

In `bin/triage.ts`, beside the existing `fetchOwnMrs`, add:

```ts
  // The latch pass's mirror image of fetchOwnMrs: every MR this board holds a
  // done review state for, whatever its outcome, rather than the MRs this
  // identity authored. Approve-outcome states stay in scope so a half-finished
  // spend can be repaired; without them nothing ever would be.
  const fetchLatchMrs = async (): Promise<LatchMrFacts[]> => {
    const states = readReviewStates();
    const prs: PullRequest[] = [];
    for (const projectPath of boardConfig.projects) {
      const repoName = boardConfig.rtRepos[projectPath];
      if (!repoName) continue;
      const res = await readProjectMRs(repoName);
      if (!res.ok || !res.data) continue;
      for (const entry of Object.values(res.data.mrs)) prs.push(entry.pr as PullRequest);
    }
    return buildBoard(prs, boardConfig)
      .filter((m) => m.webUrl && states.get(m.webUrl)?.status === "done")
      .map((m) => ({
        mrUrl: m.webUrl!,
        iid: m.iid,
        projectId: parseRepoId(m.repositoryId),
        projectPath: projectPathFromWebUrl(m.webUrl!, boardConfig.gitlabHost) ?? "",
        rtRepo: m.rtRepo ?? "",
        isApproved: !!m.reviews.isApproved,
      }));
  };
```

- [ ] **Step 2: Run the pass OUTSIDE the switchboard block**

`runNudgePass` lives inside `if (boardConfig.switchboard.url && switchboardToken) { ... }` (`bin/triage.ts:154`), and so does the `writeMemory(memory)` after it. The latch pass must **not** go in there: it exists precisely so a re-review needs no switchboard and no peer board.

First move the persist so it covers both passes. Delete this line from inside the switchboard block:

```ts
    writeMemory(memory);
```

Then, after that block's closing brace, add:

```ts
  // The latch pass writes to GitLab, so without a token there is nothing it
  // can do. Both passes bank cooldown and budget counters into the same
  // memory, and this one runs whether or not a switchboard is configured, so
  // the persist below sits outside that block.
  const latchToken = await loadGitLabToken();
  if (latchToken) {
    try {
    const latchResult = await runLatchPass({
      readReviewStates,
      fetchLatchMrs,
      readDetail: async (mr) => {
        const res = await readDiscussions(mr.rtRepo, mr.iid);
        if (!res.ok || !res.data) return null;
        return { discussions: res.data.discussions } as MRDetail;
      },
      gateway: latchGateway(boardConfig.gitlabHost, latchToken),
      launchReReview: (mrUrl, iid) =>
        launchReReview(mrUrl, iid, {
          cwd: boardConfig.reviewCwd,
          workspaceLabel: boardConfig.reviewsWorkspace,
          skill: resolveLaunchSkill("review", mrUrl, boardConfig),
          claudeCommand: boardConfig.claudeCommand,
        }),
      memory,
      cfg: triage,
      appendAudit,
      notify: (title, message) => notifyEscalation(title, message, triage.notify),
      now: () => Date.now(),
    });
    console.log(`latch pass: ${JSON.stringify(latchResult)}`);
    } catch (err) {
      // The pass makes many unguarded GitLab calls. A throw here must not cost
      // BOTH passes their cooldown and budget counters, which the persist
      // below banks.
      console.error(`latch pass failed: ${err}`);
    }
  }
  writeMemory(memory);
```

Indent the `runLatchPass({ ... })` call one level to sit inside the `try`.

- [ ] **Step 3: Add the imports**

```ts
import { runLatchPass, type LatchMrFacts } from "../src/triage/latch.ts";
import { latchGateway } from "../src/latch/gateway.ts";
```

Extend three imports `bin/triage.ts` already has, rather than adding duplicates: add `projectPathFromWebUrl` to the existing `../src/data.ts` import, `readDiscussions` to the existing `@mattstack/rt-client` import, and `parseRepoId` to the existing `@mattstack/glance` import. Add `MRDetail` as a type import from `@mattstack/glance`.

- [ ] **Step 4: Verify**

```bash
cd ~/Documents/GitHub/board && bun run typecheck && bun test
```

Expected: clean typecheck, full suite green.

- [ ] **Step 5: Dry-run the pass against real state**

```bash
cd ~/Documents/GitHub/board && bun run triage
```

Expected: exits 0. With `triage.enabled` false it exits immediately, which is the safe default; enable it only against a board whose review states you are willing to have acted on.

- [ ] **Step 6: Commit**

```bash
git add bin/triage.ts
git commit -m "triage: run the latch pass beside the nudge pass"
```

---

## Task 12: Document the feature

**Files:**
- Modify: `docs/agent-actions.md`
- Modify: `docs/peer-boards.md`

**Interfaces:**
- Consumes: everything.
- Produces: no code.

- [ ] **Step 1: Add a latch section to `docs/agent-actions.md`**

Under "Reviewer-side automation", after the "Nudge handling" block, add:

```markdown
**Latch handling.** A review that ends with a `comment` outcome posts one
resolvable thread on the MR, the re-review latch. The author resolves it when
they have addressed the feedback, and the next triage pass reads that resolved
bit, runs it through the same guardrails as a peer nudge, launches the
re-review, replies in the thread and unresolves it so the latch is armed again.

The latch is spent, meaning resolved for good and rewritten, once a review
approves the MR, so it can never block a merge on a project that requires all
discussions resolved. Every disposal replies with what happened, so a
cooldown or budget refusal is visible to the author rather than silent.
```

- [ ] **Step 2: Note the relationship in `docs/peer-boards.md`**

In the "What it adds" list, after the "Request re-review" bullet, add:

```markdown
- **Author-driven re-review.** Independent of the switchboard: the MR author can
  ask by resolving the latch thread on the MR itself, with no peer board
  involved. See [agent actions](agent-actions.md#reviewer-side-automation).
```

- [ ] **Step 3: Commit**

```bash
git add docs/agent-actions.md docs/peer-boards.md
git commit -m "docs: describe the re-review latch"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: lifecycle states 1-4 (Tasks 9, 10); the already-approved MR (Task 10, step 3 branch); every-disposal-replies-and-unresolves plus the spend exception (Task 10, `consume` and `spendLatch`); posting from the choke point (Task 9); the self-healing reconciliation (Task 10, step 0); the ordered branch list including the descope (Task 10); one decision function, two sources (Task 8); the two markers (Task 4); the banner (Task 5); dedupe with newest-wins and request consumption (Tasks 6, 10); the glance additions (Tasks 1-3); the `discussions.ts` exclusion (Task 7); the cost bound (no code, it is a property of existing pruning); every test the spec's Testing section names (Tasks 4, 6, 7, 9, 10).

**Type consistency.** `LatchRef` carries `rootNoteId` from its definition in Task 6, so Task 9's spend never widens it. `LatchMrFacts` carries `rtRepo` from its definition in Task 10, so Task 11's multi-project `readDetail` needs no correction. `latchGateway` is created in `src/latch/gateway.ts` in Task 9 and imported by both callers, so it is never moved. No task redefines an interface an earlier task established.

**Out of scope, per the spec.** GitHub parity, `resolvedBy` verification, free-text focus hints, and self-healing a second review cycle when the server missed the notify.
