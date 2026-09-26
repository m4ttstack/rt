# Review Gate Redesign Implementation Plan (mattstack-apps half)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the locked palette, per-finding review gates, and the full-screen board review sheet.

**Architecture:** Three layers land bottom-up: the token palette (one source file + codegen), gate-kit chunk utilities shared by every renderer, then the board's review-post sheet and the wrapper skill that builds the new gate shape. The mattstack-skills engine/posting changes are a separate plan in that repo; every task here tolerates their absence (tier-option gates keep rendering generically).

**Tech Stack:** Bun workspace, React + tui-kit (board client), bun test, tokens codegen via `bun run tokens:codegen`.

**Spec:** `docs/superpowers/specs/2026-09-18-review-gate-redesign-design.md`

## Global Constraints

- Run everything from the repo root with `bun`; never `bun install` inside a member (root `bun.lock` is the only lockfile).
- `bun run tui-kit:build` before any board typecheck/test/build.
- CI gates that must stay green: `bun run tokens:codegen && git diff --exit-code packages/tui-kit/src/generated packages/tui-kit/assets packages/tokyo/src`, `scripts/repo-purity.sh`, `bunx prettier --check`.
- This repo is public: all fixture/story content is invented (acme/webapp MRs, invented names); never real review text.
- Locked palette (light halves; dark untouched): accent `#4658ff` / accentText `#3a3fe8`, ok `#00c287` / okText `#008559`, purple `#9b45ff`, cyan `#00b8d9`, warn `#ff8a00` / warnText `#bd6500`, bad `#ff3d81`.
- No em dashes in any authored text. No ticket references in source comments.
- Commit after every task (incremental commits rule).

## File Structure

- `packages/tokens/src/values.ts` - palette source (Task 1)
- `packages/tokens/scripts/generate.ts` - emits tui-kit tokens + tokyo css (Task 1)
- `apps/board/src/style.css` - gate selection states + sheet styles (Tasks 2, 6)
- `packages/gate-kit/src/chunks.ts` (new) - chunk collapse/split (Task 3)
- `apps/board/src/review-state.ts`, `apps/board/src/server.ts`, `apps/board/src/state/agent-states.ts` - report.json serve + prune (Task 4)
- `apps/board/src/client/board/finding-option.ts` (new) - option label/description parsing (Task 5)
- `apps/board/src/client/board/ReviewGateSheet.tsx` (new) - the full-screen sheet (Task 6)
- `apps/board/src/client/board/DecisionQueueModal.tsx` - kind routing + submit union (Task 7)
- `apps/board/skills/review/SKILL.md` - wrapper gate build (Task 8)

---

### Task 1: Locked palette in `packages/tokens` + regenerated artifacts

**Files:**
- Modify: `packages/tokens/src/values.ts` (light `hue` block ~line 58, light `text` block ~line 66, `ColorScheme` interface `text` member, dark `text` block)
- Modify: `packages/tokens/scripts/generate.ts` (`buildTuiKitColors` gray map ~line 55, `buildTokyoDeclarations` ~line 150, `renderTokyoSchemeBlock` declaration list)
- Regenerate: `packages/tui-kit/src/generated/tokens.ts`, `packages/tui-kit/src/generated/theme.css` (via tui-kit codegen), `packages/tokyo/src/tokyo-theme.css`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS vars `--green-text` is NOT introduced kit-side by this task; it produces token leaves `text.okText`, `text.warnText`, and `text.badgeText` surfaced as `--color-gray-okText` / `--color-gray-warnText` (tui-kit) and `--tk-green-text` / `--tk-amber-text` (tokyo). Task 2 and Task 6 consume the tui-kit vars.

- [ ] **Step 1: Edit the light hue block in `values.ts`**

```ts
    hue: {
      accent: '#4658ff',
      ok: '#00c287',
      bad: '#ff3d81',
      warn: '#ff8a00',
      purple: '#9b45ff',
      cyan: '#00b8d9',
    },
```

- [ ] **Step 2: Add the two text companions**

In the `ColorScheme` interface `text` member add `okText: string;`, `warnText: string;`, and `badgeText: string;` after `accentText`. Light values: `accentText: '#3a3fe8'`, `okText: '#008559'`, `warnText: '#bd6500'`, `badgeText: '#454b66'` (the darkened small-badge text the mock locked). Dark values: `okText: '#9ece6a'`, `warnText: '#e0af68'` (the dark hues, already AA there), `badgeText: '#aab3d8'` (matches dark mutedOnCard). Leave every other dark value untouched.

- [ ] **Step 3: Emit the new leaves in `generate.ts`**

In `buildTuiKitColors`'s `gray` map, after the `accentText` line:

```ts
      okText: at('text.okText', t.text.okText),
      warnText: at('text.warnText', t.text.warnText),
      badgeText: at('text.badgeText', t.text.badgeText),
```

In `buildTokyoDeclarations`, after `accentText`: `okText: at('text.okText', t.text.okText),`, `badgeText: at('text.badgeText', t.text.badgeText),` and after `amber`: `amberText: at('text.warnText', t.text.warnText),`. In `renderTokyoSchemeBlock`'s declaration array add `--tk-green-text: ${d.okText};` directly after the `--tk-green` line, `--tk-amber-text: ${d.amberText};` after `--tk-amber`, and `--tk-badge-text: ${d.badgeText};` after the accent-text line. Do not touch `CSS_TEXT` (new leaves have no historical spelling to preserve).

- [ ] **Step 4: Regenerate and verify freshness**

Run: `bun run tokens:codegen && bun run tui-kit:build`
Then: `git diff --stat packages/tui-kit/src/generated packages/tokyo/src` shows the recolor; `bun run tokens:codegen && git diff --exit-code packages/tui-kit/src/generated packages/tui-kit/assets packages/tokyo/src` exits 0.

- [ ] **Step 5: Check nothing keyed on the old hexes**

Run: `grep -rn "2e7de9\|587539\|8c6c3e\|7847bd\|007197\|f52a65\|1c5fbf" packages apps --include='*.ts' --include='*.tsx' --include='*.css' | grep -v generated | grep -v tokyo-theme | grep -v test`
Expected: no hits outside comments. Fix any literal by switching it to the var.

- [ ] **Step 6: Run the affected suites**

Run: `bun run tokens:test && bun run tui-kit:gates && bun run board:typecheck && bun run board:test`
Expected: green. (tui-kit visual snapshots are excluded from CI; refresh locally only if a later task needs them.)

- [ ] **Step 7: AA pass on the text companions**

Compute WCAG contrast for each light text value on `#ffffff`: `bun -e` with the standard relative-luminance formula over `['#3a3fe8','#008559','#bd6500','#454b66','#565d80','#ff3d81']`. Every companion used for body-size text must clear 4.5; a value that misses gets darkened along its own hue until it clears, keeping the hue family, and the final hex goes in the commit body. (`#ff3d81` is fill/large-bold only and is exempt; note it.)

- [ ] **Step 8: Commit**

```bash
git add packages/tokens packages/tui-kit/src/generated packages/tokyo/src
git commit -m "tokens: lock the arcade light palette, add ok/warn/badge text companions"
```

### Task 2: Gate selection states move from amber to accent

**Files:**
- Modify: `apps/board/src/style.css` (`.tui-gate-choice[data-checked]` ~line 2024, `.tui-gate-choice:has(> input:focus-visible)` ~line 2028, `.tui-gate-choice-input[data-checked]` ~line 2057, `.tui-gate-choice-input:focus-visible` ~line 2061)
- Test: `apps/board/src/client/board/__tests__/gate-form-context-fallback-dom.test.tsx` (existing DOM suite proves nothing broke)

**Interfaces:**
- Consumes: `--accent` (existing var, now `#4658ff`).
- Produces: nothing new; every gate kind's checked state renders accent.

- [ ] **Step 1: Swap the four amber references**

```css
.tui-gate-choice[data-checked] {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.tui-gate-choice:has(> input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.tui-gate-choice-input[data-checked] {
  border-color: var(--accent);
  background: var(--accent);
}
.tui-gate-choice-input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Then: `grep -n "var(--amber)" apps/board/src/style.css` and confirm every remaining hit is a signal use (phrase pills, status words, delivery button intent), not a selection or primary action.

- [ ] **Step 2: Run the board client DOM tests**

Run: `bun run board:test`
Expected: green (no test pins the amber value; if one does, update it to accent and note it in the commit body).

- [ ] **Step 3: Commit**

```bash
git add apps/board/src/style.css
git commit -m "board: gate checked and focus states use accent, amber stays a signal color"
```

### Task 3: gate-kit chunked-question utilities

**Files:**
- Create: `packages/gate-kit/src/chunks.ts`
- Modify: `packages/gate-kit/src/index.ts` (re-export)
- Test: `packages/gate-kit/src/chunks.test.ts`

**Interfaces:**
- Consumes: `GateQuestion` from `./types`.
- Produces:
  - `chunkGroupKey(id: string): string | null` - `"findings-2"` gives `"findings"`, non-chunk ids give `null`.
  - `collapseChunks(questions: GateQuestion[]): { questions: GateQuestion[]; groups: Map<string, string[]> }` - adjacent `<base>-1..N` multi questions merge into one synthetic question with id `<base>`, options concatenated in order, `label`/`context` taken from the first chunk; `groups` maps base id to the original chunk ids in order.
  - `splitChunkSelections(groups: Map<string, string[]>, questions: GateQuestion[], selections: Record<string, string[]>): Record<string, string[]>` - a union selection keyed by base id splits back into per-chunk arrays by option membership; unknown values throw.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'bun:test';
import { chunkGroupKey, collapseChunks, splitChunkSelections } from './chunks';
import type { GateQuestion } from './types';

const q = (id: string, options: string[], multi = true): GateQuestion => ({
  id,
  label: `Post which findings? (${id})`,
  multi,
  options,
});

describe('chunkGroupKey', () => {
  test('matches <base>-<n> and nothing else', () => {
    expect(chunkGroupKey('findings-1')).toBe('findings');
    expect(chunkGroupKey('findings-12')).toBe('findings');
    expect(chunkGroupKey('findings')).toBeNull();
    expect(chunkGroupKey('outcome')).toBeNull();
    expect(chunkGroupKey('fix-up-2x')).toBeNull();
  });
});

describe('collapseChunks', () => {
  test('merges adjacent numbered multis and keeps others in place', () => {
    const questions = [
      q('findings-1', ['f1', 'f2', 'f3', 'f4']),
      q('findings-2', ['f5', 'f6']),
      q('outcome', ['approve', 'comment'], false),
    ];
    const { questions: out, groups } = collapseChunks(questions);
    expect(out.map(x => x.id)).toEqual(['findings', 'outcome']);
    expect(out[0]!.options).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6']);
    expect(groups.get('findings')).toEqual(['findings-1', 'findings-2']);
  });

  test('a single unchunked question set passes through untouched', () => {
    const questions = [q('tiers', ['Minor'], true)];
    const { questions: out, groups } = collapseChunks(questions);
    expect(out).toEqual(questions);
    expect(groups.size).toBe(0);
  });

  test('non-adjacent chunks sharing a base throw instead of mis-grouping', () => {
    expect(() =>
      collapseChunks([
        q('findings-1', ['f1']),
        q('outcome', ['approve'], false),
        q('findings-2', ['f2']),
      ])
    ).toThrow();
  });

  test('a lone -1 chunk still collapses to its base id', () => {
    const { questions: out, groups } = collapseChunks([q('findings-1', ['f1'])]);
    expect(out[0]!.id).toBe('findings');
    expect(groups.get('findings')).toEqual(['findings-1']);
  });
});

describe('splitChunkSelections', () => {
  test('splits the union back by option membership', () => {
    const questions = [
      q('findings-1', ['f1', 'f2', 'f3', 'f4']),
      q('findings-2', ['f5', 'f6']),
    ];
    const { groups } = collapseChunks(questions);
    const split = splitChunkSelections(groups, questions, {
      findings: ['f2', 'f5'],
    });
    expect(split).toEqual({ 'findings-1': ['f2'], 'findings-2': ['f5'] });
  });

  test('empty union answers every chunk with an explicit empty array', () => {
    const questions = [q('findings-1', ['f1']), q('findings-2', ['f2'])];
    const { groups } = collapseChunks(questions);
    expect(splitChunkSelections(groups, questions, { findings: [] })).toEqual({
      'findings-1': [],
      'findings-2': [],
    });
  });

  test('a value in no chunk throws', () => {
    const questions = [q('findings-1', ['f1'])];
    const { groups } = collapseChunks(questions);
    expect(() =>
      splitChunkSelections(groups, questions, { findings: ['zz'] })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/gate-kit && bun test src/chunks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { optionValue } from './options';
import type { GateQuestion } from './types';

const CHUNK_RE = /^(.*)-(\d+)$/;

export function chunkGroupKey(id: string): string | null {
  const m = CHUNK_RE.exec(id);
  return m ? m[1]! : null;
}

export function collapseChunks(questions: GateQuestion[]): {
  questions: GateQuestion[];
  groups: Map<string, string[]>;
} {
  const out: GateQuestion[] = [];
  const groups = new Map<string, string[]>();
  for (const question of questions) {
    const base = question.multi ? chunkGroupKey(question.id) : null;
    if (base === null) {
      out.push(question);
      continue;
    }
    const prior = groups.get(base);
    if (prior && out.length > 0 && out[out.length - 1]!.id === base) {
      const merged = out[out.length - 1]!;
      out[out.length - 1] = {
        ...merged,
        options: [...merged.options, ...question.options],
      };
      prior.push(question.id);
    } else {
      if (groups.has(base))
        throw new Error(`non-adjacent chunks for ${base}: ${question.id}`);
      out.push({ ...question, id: base });
      groups.set(base, [question.id]);
    }
  }
  return { questions: out, groups };
}

export function splitChunkSelections(
  groups: Map<string, string[]>,
  questions: GateQuestion[],
  selections: Record<string, string[]>
): Record<string, string[]> {
  const byId = new Map(questions.map(question => [question.id, question]));
  const out: Record<string, string[]> = {};
  for (const [base, chunkIds] of groups) {
    const picked = new Set(selections[base] ?? []);
    for (const chunkId of chunkIds) {
      const question = byId.get(chunkId);
      if (!question) throw new Error(`unknown chunk question ${chunkId}`);
      out[chunkId] = question.options
        .map(optionValue)
        .filter(value => picked.delete(value));
    }
    if (picked.size > 0)
      throw new Error(
        `selection values outside ${base} chunks: ${[...picked].join(', ')}`
      );
  }
  return out;
}
```

Re-export from `packages/gate-kit/src/index.ts`: `export { chunkGroupKey, collapseChunks, splitChunkSelections } from './chunks';`

- [ ] **Step 4: Run tests**

Run: `cd packages/gate-kit && bun run test`
Expected: PASS, including the existing suite.

- [ ] **Step 5: Commit**

```bash
git add packages/gate-kit/src/chunks.ts packages/gate-kit/src/chunks.test.ts packages/gate-kit/src/index.ts
git commit -m "gate-kit: collapse chunked findings questions and split union answers"
```

### Task 4: Board serves `report.json`, prune unlinks it

**Files:**
- Modify: `apps/board/src/review-state.ts` (beside the existing report-path helper ~line 81)
- Modify: `apps/board/src/server.ts` (new case beside `/review/report` ~line 2580)
- Modify: `apps/board/src/state/agent-states.ts` (`pruneStates` unlink loop)
- Test: `apps/board/src/__tests__/review-report-json.test.ts` (new)

**Interfaces:**
- Consumes: `reportPathForHandle(handle)` (existing).
- Produces: `readReviewReportJson(mrUrl: string): string | null` and route `GET /review/report.json?mr=<url>` returning `application/json` or 404. Task 6's sheet fetches this route.

- [ ] **Step 1: Write the failing test**

Follow the existing report-read test pattern in `src/__tests__` (temp state dir + handle file). Assert: writing `<handle>.json` beside the md makes `readReviewReportJson(mrUrl)` return its text; no file gives `null`; `pruneStates` on a tombstoned row unlinks both `<handle>.md`-sibling report and the `.json` sibling.

```ts
import { describe, expect, test } from 'bun:test';
import { readReviewReportJson } from '../review-state.ts';
// arrange with the same tmp-dir/handle scaffolding the sibling
// review-report tests in this directory already use; the json fixture is
// {"summary":{"readiness":"yes","reasoning":"solid"},"findings":[]}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/__tests__/review-report-json.test.ts`
Expected: FAIL, `readReviewReportJson` not exported.

- [ ] **Step 3: Implement**

`review-state.ts`: derive the json path from the report path (`reportPath.replace(/\.md$/, '.json')`; if the report path carries no extension, append `.json`), read with the same try/catch-ENOENT shape as the md reader. `server.ts`, new case cloned from `/review/report`:

```ts
      case '/review/report.json': {
        const mrUrl = new URL(req.url).searchParams.get('mr');
        if (!mrUrl) return new Response('expected ?mr=<url>', { status: 400 });
        const report = readReviewReportJson(mrUrl);
        if (report === null)
          return new Response('no structured review yet', { status: 404 });
        return new Response(report, {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
```

`agent-states.ts` prune: where the tombstone loop unlinks the handle-sibling report file, also best-effort unlink the `.json` sibling with the same catch-and-continue shape.

- [ ] **Step 4: Run tests**

Run: `cd apps/board && bun test src/__tests__/review-report-json.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/review-state.ts apps/board/src/server.ts apps/board/src/state/agent-states.ts apps/board/src/__tests__/review-report-json.test.ts
git commit -m "board: serve the structured review report, prune its file with the md"
```

### Task 5: Finding-option parser

**Files:**
- Create: `apps/board/src/client/board/finding-option.ts`
- Test: `apps/board/src/client/board/__tests__/finding-option.test.ts`

**Interfaces:**
- Consumes: `GateOption`, `optionValue`, `optionDisplayFor`, `optionDescription` from `@mattstack/gate-kit`.
- Produces: `parseFindingOption(option: GateOption): ParsedFinding | null` where `ParsedFinding = { id: string; tier: string; title: string; anchor?: string; fix?: string; kind?: string }`. Returns `null` unless the label matches `[Tier] title`. A trailing ` · kind:<word>` segment pops off into `kind` first. The remaining description splits on the first ` · ` into anchor and fix; a description with no separator is all fix when it has no `/` or `:`-digit shape, else all anchor.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'bun:test';
import { parseFindingOption } from '../finding-option.ts';

describe('parseFindingOption', () => {
  test('parses tier, title, anchor, fix', () => {
    expect(
      parseFindingOption({
        value: 'f3',
        label: '[Minor] Em dash in the new describe title',
        description:
          'workflow.integration.test.ts:12 · use a hyphen; change both siblings · kind:nitpick',
      })
    ).toEqual({
      id: 'f3',
      tier: 'Minor',
      title: 'Em dash in the new describe title',
      anchor: 'workflow.integration.test.ts:12',
      fix: 'use a hyphen; change both siblings',
      kind: 'nitpick',
    });
  });

  test('description without separator that looks like a path is an anchor', () => {
    const parsed = parseFindingOption({
      value: 'f9',
      label: '[Important] Evidence section is empty',
      description: 'apps/webapp/src/services/api.tsx',
    });
    expect(parsed?.anchor).toBe('apps/webapp/src/services/api.tsx');
    expect(parsed?.fix).toBeUndefined();
  });

  test('non-finding options give null', () => {
    expect(parseFindingOption('approve')).toBeNull();
    expect(
      parseFindingOption({ value: 'Minor', label: 'Minor (4)' })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/__tests__/finding-option.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import {
  optionDescription,
  optionDisplayFor,
  optionValue,
  type GateOption,
} from '@mattstack/gate-kit';

export interface ParsedFinding {
  id: string;
  tier: string;
  title: string;
  anchor?: string;
  fix?: string;
}

const LABEL_RE = /^\[([A-Za-z]+)\]\s+(.+)$/;
const ANCHORISH_RE = /\/|\.[a-z]+:\d+$|^[A-Z_]{3,}$/;
const KIND_RE = /\s·\skind:([a-z-]+)$/;

export function parseFindingOption(option: GateOption): ParsedFinding | null {
  const label = optionDisplayFor(option).text;
  const m = LABEL_RE.exec(label);
  if (!m) return null;
  const parsed: ParsedFinding = {
    id: optionValue(option),
    tier: m[1]!,
    title: m[2]!,
  };
  let description = optionDescription(option);
  if (description !== undefined) {
    const k = KIND_RE.exec(description);
    if (k) {
      parsed.kind = k[1]!;
      description = description.slice(0, -k[0].length);
    }
  }
  if (description !== undefined) {
    const at = description.indexOf(' · ');
    if (at >= 0) {
      parsed.anchor = description.slice(0, at);
      parsed.fix = description.slice(at + 3);
    } else if (ANCHORISH_RE.test(description)) {
      parsed.anchor = description;
    } else {
      parsed.fix = description;
    }
  }
  return parsed;
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/board && bun test src/client/board/__tests__/finding-option.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client/board/finding-option.ts apps/board/src/client/board/__tests__/finding-option.test.ts
git commit -m "board: parse finding options into tier, title, anchor, fix"
```

### Task 6: `ReviewGateSheet` component and styles

**Files:**
- Create: `apps/board/src/client/board/ReviewGateSheet.tsx`
- Modify: `apps/board/src/client/board/icons.tsx` (three new inline SVG glyphs)
- Modify: `apps/board/src/style.css` (append a `/* review gate sheet */` section)
- Test: `apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx`
- Story: `apps/board/src/client/board/ReviewGateSheet.stories.tsx`

**Interfaces:**
- Consumes: `collapseChunks` (Task 3), `parseFindingOption` (Task 5), `useGateForm`/`GateFormState` from `./GateForm.tsx`, `Invadr` (as `Sidebar.tsx:84` uses it), `GET /review/report.json?mr=` (Task 4), `parseGateContext` (existing).
- Produces: `ReviewGateSheet({ gate, mr, form, queue, onClose, onSkip, onFocusPane })` where `queue = { index: number; total: number; states: TriageGateState[]; onPrev(): void; onNext(): void }`. `isReviewSheetGate(gate: GateRow): boolean` exported for Task 7 (true when `kind === 'review-post'` and at least one option parses as a finding).

Component structure (class names are the contract for the CSS section; render exactly these regions):

```tsx
<div className="tui-review-sheet" role="dialog" aria-modal="true">
  <header className="tui-review-sheet-head">
    {/* title, focus-pane / skip-gate chips, spacer, queue nav (chevrons,
        one pip per queue.states entry, "gate n of m"), gate tag, close */}
  </header>
  <div className="tui-review-sheet-body">
    <section className="tui-review-sheet-main">
      {/* MR card: <Invadr id={author}/> + author name (accent purple class
          tui-review-author), "opened !iid into target · age", title, meta.
          Then FindHead (question + "n of m selected · k more below"),
          tier groups (wash pill + all/none buttons), finding rows
          (checkbox input, title, kind tag from description-less options
          omitted, mono anchor, fix line), then the record cluster when
          report.json arrived: STRENGTHS/DEPTH/EVIDENCE/NOTES label column
          plus green disc checks and the record icons from icons.tsx. */}
    </section>
    <aside className="tui-review-sheet-rail">
      {/* Decision context card (readiness lead + reasoning + tier pills),
          checks card (PASS/N/A chips), verdict heading, outcome options as
          gate choices, note field, submit button
          `post {selected.length} · {outcome}` , reset. */}
    </aside>
  </div>
</div>
```

Data flow: `const { questions, groups } = useMemo(() => collapseChunks(gate.questions), [gate.questions])`; findings = the collapsed multi question whose options all parse via `parseFindingOption`; outcome = the remaining single-select. Selection state and submit come from the existing `useGateForm` (Task 7 passes the split-back answers, so the sheet's form state keys by collapsed ids). `report.json` is fetched once per mrUrl into local state. The record cluster renders only from the json's optional arrays; when the fetch fails, 404s, or the json carries none of the optional arrays, the sheet instead renders a `full report` disclosure below the findings that lazily fetches `/review/report?mr=` and renders the markdown (same `Markdown` component the queue modal uses), so the review's prose is never unreachable.

- [ ] **Step 1: Write the failing DOM test**

Follow `attention-card-dom.test.tsx`'s harness. Fixture gate: kind `review-post`, questions `findings-1` (four `[Tier] title` options with `file:line · fix` descriptions, invented content), `findings-2` (two options), `outcome` (`approve (recommended)`, `comment`). Assert: one findings list with six rows (chunks collapsed); tier group headers show counts; the tally reads `6 of 6 selected`; unchecking a row updates the tally and the submit label (`post 5 · approve`); the verdict options render as gate choices with the recommended badge; `isReviewSheetGate` is true for the fixture and false for a tier-option gate (`{value:'Minor',label:'Minor (4)'}`).

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/__tests__/review-gate-sheet-dom.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

First add `SearchCheckIcon`, `CameraIcon`, and `PencilLineIcon` to `icons.tsx` as inline SVG components following that file's existing pattern (24-unit viewBox, `currentColor` strokes; copy the path data from the lucide SVG set, which is ISC licensed, and note the origin in the icons.tsx header if it does not already credit it). lucide is NOT added as a dependency; the catalog and lockfile do not change. Then build exactly the structure above, the record cluster using those three components at 14px. Checkbox rows reuse `.tui-gate-choice-input[data-type='checkbox']` styling; all/none are `<button type="button" className="tui-review-allnone">` mutating the same selection state; kind tag renders from `parsed.kind` when present. Keep every color a var: accent for selection and primary, `--color-gray-okText` for PASS/RECOMMENDED text, `--color-gray-warnText` for Important pill text with `color-mix(in srgb, var(--amber) 15%, transparent)` washes, `--color-gray-badgeText` for kind-tag text, purple for the author, no literal hexes.

- [ ] **Step 4: Append the CSS section**

New section in `style.css` keyed to the class names above: sheet fills the viewport (`position: fixed; inset: 0; background: var(--card); display: flex; flex-direction: column;`), head row bordered below, body `flex: 1; display: flex; min-height: 0;`, main `flex: 1; overflow-y: auto; padding: 22px 28px;`, rail `width: 470px; border-left: 1px solid var(--border); background: var(--panel); display: flex; flex-direction: column; gap: 14px; padding: 22px 26px; overflow-y: auto;`. Record-cluster label column: `width: 78px; text-align: right; font-size: 10px; letter-spacing: 0.5px; color: var(--muted);`. all/none states per the mock: rest muted, `:hover` accent + underline, `:active` deeper via `color-mix(in srgb, var(--accent) 80%, var(--fg))`, `[data-noop]` gray with `pointer-events: none`. The findings list wrapper gets a sticky bottom fade (`::after`, transparent to `var(--card)`, ~46px) toggled off via `[data-at-end]` when a scroll listener reports the region scrolled to its end; the head tally appends `· k more below` from the same measurement.

- [ ] **Step 5: Run tests, add the story**

Run: `cd apps/board && bun test src/client/board/__tests__/review-gate-sheet-dom.test.tsx`
Expected: PASS. Then add `ReviewGateSheet.stories.tsx` mirroring `DecisionQueueModal.stories.tsx`'s scaffolding with the six-finding fixture and a clean-review (outcome-only) variant.

- [ ] **Step 6: Commit**

```bash
git add apps/board/src/client/board/ReviewGateSheet.tsx apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx apps/board/src/client/board/ReviewGateSheet.stories.tsx apps/board/src/client/board/icons.tsx apps/board/src/style.css
git commit -m "board: full-screen review gate sheet"
```

### Task 7: Route review gates to the sheet, split answers on submit

**Files:**
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx` (~line 171 component body; the queue host renders the sheet in place of the kit `Modal` when `isReviewSheetGate(gate)`)
- Modify: `apps/board/src/client/board/GateForm.tsx` (`useGateForm` submit path accepts a `transformAnswers` hook)
- Test: extend `apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx`

**Interfaces:**
- Consumes: `isReviewSheetGate`, `ReviewGateSheet` (Task 6), `splitChunkSelections` (Task 3).
- Produces: submit posts per-chunk answers keyed by the original `findings-N` ids plus `outcome`; every other gate kind renders through the existing `Modal` + `GateForm` path untouched.

- [ ] **Step 1: Write the failing test**

In the DOM test, submit the sheet with two rows unchecked and assert the answer payload passed to the (mocked) gate-answer fetch carries `{"findings-1": [...], "findings-2": [...]}` with the union split by chunk membership and the explicit empty array when a chunk has nothing picked, never a `findings` key.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/__tests__/review-gate-sheet-dom.test.tsx`
Expected: FAIL on payload shape.

- [ ] **Step 3: Implement**

`useGateForm` gains an optional `transformAnswers?: (answers: GateAnswers) => GateAnswers` applied in `submit` before the fetch. The sheet passes `answers => ({ ...splitChunkSelections(groups, gate.questions, pickMultis(answers)), ...singles(answers) })`. `DecisionQueueModal` renders `<ReviewGateSheet .../>` for `isReviewSheetGate(gate)`, forwarding its existing queue state (`TriageGateState[]`, index, advance/skip handlers, focus-pane action); the generic branch is untouched.

- [ ] **Step 4: Run the full board suite**

Run: `bun run tui-kit:build && bun run board:typecheck && bun run board:test`
Expected: green, including all pre-existing modal tests.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client/board/DecisionQueueModal.tsx apps/board/src/client/board/GateForm.tsx apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx
git commit -m "board: review gates open the sheet, submit splits chunk unions"
```

### Task 8: Wrapper skill builds the per-finding gate

**Files:**
- Modify: `apps/board/skills/review/SKILL.md` (step 4 "Build the questions" block and the form-branch notes)

**Interfaces:**
- Consumes: `report.json` (contract in the spec section 1; the sibling of `--report`).
- Produces: gate questions in the shape Tasks 5-7 parse: `findings-N` multis (option value = finding id, label = `[Tier] title` middle-truncated to 200 bytes, description = `anchor · fix` with ` · kind:<word>` appended when the finding carries a kind, 1024-byte cap), `outcome` single with descriptions and the `(recommended)` suffix; gate `--context` = readiness line + tier counts.

- [ ] **Step 1: Capture the baseline**

Extract the current step 4 into the scratchpad and dry-run a fresh subagent with an invented `report.json` (two tiers, five findings) asking for the exact `gate open` invocation. Expected baseline failure: tier-level options, no ids.

- [ ] **Step 2: Rewrite step 4**

Replace the "Build the questions" block: read the json (fall back to tier options with a one-line note when it is absent); one option per finding, chunked at four per question (`findings-1..N`, Critical first, report order within tier); option description is `anchor · fix` plus a ` · kind:<word>` suffix when the finding carries a kind; the JSON example in the skill uses invented content; verdict question label `Verdict on !<iid>: <readiness clause>`; keep the recommended-suffix, context-budget, resume, and degraded-mode paragraphs, updating the degraded combined-form and resume text to the same finding-id shape; answer handling passes `{findings: [ids], outcome}` to the domain skill (ids = union of the `findings-N` answers).

- [ ] **Step 3: Verify with the same scenario**

Re-run the dry-run subagent with the rewritten step 4. Expected: chunked per-finding questions, byte-safe labels, verdict label carrying the readiness clause. Iterate until compliant.

- [ ] **Step 4: Commit**

```bash
git add apps/board/skills/review/SKILL.md
git commit -m "board skills: review gate carries one option per finding"
```

### Task 9: Full gates and cleanup

**Files:**
- None new; whole-repo verification.

- [ ] **Step 1: Full local CI mirror**

Run: `bun run tokens:codegen && git diff --exit-code packages/tui-kit/src/generated packages/tui-kit/assets packages/tokyo/src && bun run tui-kit:build && bun run tui-kit:gates && bun run board:typecheck && bun run board:test && bun run gate-kit:test && bunx prettier --check . --cache && scripts/repo-purity.sh`
Expected: everything green.

- [ ] **Step 2: Served sanity pass**

Run `bun run board:build`, `deck restart board`, open the board, confirm: a tier-option gate (pre-contract) still renders the generic modal; the storybook sheet states match the pen mock.

- [ ] **Step 3: Cross-app recolor check-in**

The tokens PR recolors every app. Before merging it, run chat, console, and deck locally against the rebuilt packages (or state explicitly that Matt waived the preview) and get Matt's go on the cross-app look. This resolves the spec's open question; record the answer in the tokens PR description.

- [ ] **Step 4: Commit any stragglers and stop**

PR split at the end: Task 1-2 ship as the tokens PR; Tasks 3-9 as the board PR (spec section 6).

---

## Self-review notes

- Spec coverage: contract emission and posting (spec sections 1-2) are the mattstack-skills plan, deliberately absent here; everything else in the spec maps to Tasks 1-8.
- The record cluster renders only once the wrapper writes `report.json` (spec optional arrays); the sheet without it is still complete (Task 6 fallback).
- Type consistency: `collapseChunks`/`splitChunkSelections` names and signatures match between Tasks 3, 6, 7; `parseFindingOption` between 5 and 6; `readReviewReportJson` between 4 and 6.
