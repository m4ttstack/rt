# MR Row Direction B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the board's MR row up to the approved direction B: a header line that always has a job, one hue per pill state, flags as colored words, the behind count off the facts line, a full-weight threads token, and the sun without its tagline.

**Architecture:** The row keeps its four lines, its 114px height and its status-line machinery; every change is in what the header line (line 0) and the facts line (line 2) carry, plus the pill and thread-link renderers and their CSS. Derivations stay in `row-status.ts` / `view.ts` (pure, unit-tested), rendering in `RowView.tsx` / `CommentsDrawer.tsx` (DOM-tested), and the fixture capture set is the visual parity gate against the approved renders.

**Tech Stack:** React 19, TypeScript, bun test with happy-dom, Playwright captures (`bun run capture:baseline` / `capture:compare`), Tokyo Night tokens from `@mattstack/tui-kit`.

**Spec:** `docs/design/board/README.md` (rulings) with `docs/design/board/board.pen` and `docs/design/board/renders/B-*.png`, `B0-*.png` … `B4-*.png` as the drawn reference.

## Global Constraints

- The row stays a fixed `--row-h: 114px`; nothing on a row may grow it.
- No separator glyphs on the row: no `·`, no `|`. Junctions step in size, weight or color. The mockup's `· 2 await you` is rendered as a separate colored span, without the middot. `row-view-dom.test.tsx` asserts `textContent` never contains `·`.
- Never use em dashes or en dashes in code, comments, tests or the PR.
- Comments only for a constraint the code cannot show; no decision history in source.
- Verb kinds and tones in `row-status.ts` do not change (`needs-me.ts` keys on them); run `needs-me.test.ts` after every `row-status.ts` edit.
- `view.ts`'s `statusBucket` grouping keeps its `commented` / `comments resolved` buckets; only the pill drops them.
- The fixture (`apps/board/tests/fixture`) and every name in tests stay invented; the root `scripts/repo-purity.sh` gate must pass before the PR.
- Work from `apps/board` in the `mr-row-b` worktree; root scripts run from the repo root. `bun run tui-kit:build` must run once before `board:typecheck`.
- Commit after each task with a short imperative subject ending in the `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` line.

---

## File structure

| file | responsibility after this plan |
| --- | --- |
| `apps/board/src/client/board/row-status.ts` | `statusPhrase` returns `{ text, hue }` for the four approval states; `reviewerLine`'s all-clear has no detail |
| `apps/board/src/view.ts` | `statusFlags` returns `{ key, text, title? }` keyed by `FlagKey`, draft included; `behindToken` text reads `N behind` |
| `apps/board/src/client/board/icons.tsx` | adds `FlagGlyph`, `ArrowDownGlyph`, `ArrowOutGlyph`, `MessageGlyph` (12px lucide outlines) |
| `apps/board/src/client/board/RowView.tsx` | line 0 = lead (author or ticket, flags, behind) + marks + pill; line 2 = iid, branch, diff, rail |
| `apps/board/src/client/board/CommentsDrawer.tsx` | `ThreadsLink` renders the token with its `await` / `replied` qualifiers |
| `apps/board/src/style.css` | pill soft fill by `data-hue`, `.tui-flag`, `.tui-row-lead`, muted author and behind, the threads token, `--orange` |
| `apps/board/tests/baselines/*.png` | recaptured |
| `docs/design/board/README.md` | pill states corrected to four; the token's junctions noted as color, not glyphs |

---

### Task 1: The pill owns the approval axis, one hue per state

**Files:**
- Modify: `apps/board/src/client/board/row-status.ts:100-120` (`statusPhrase`)
- Modify: `apps/board/src/client/board/RowView.tsx:71-80` (`StatusPhrase`)
- Modify: `apps/board/src/style.css:384-405` (`.tui-phrase`)
- Test: `apps/board/src/client/board/__tests__/row-status.test.ts`
- Test: `apps/board/src/client/board/__tests__/row-view-dom.test.tsx`

**Interfaces:**
- Produces: `export type PillHue = 'red' | 'green' | 'cyan' | 'amber'` and `export function statusPhrase(mr: BoardMR): { text: string; hue: PillHue }` in `row-status.ts`. The `cls` field is gone; `.tui-phrase` carries `data-hue`.

- [ ] **Step 1: Write the failing unit tests**

Append to `apps/board/src/client/board/__tests__/row-status.test.ts` (it already imports `rowStatus`; add `statusPhrase` to that import from `'../row-status.ts'`):

```ts
describe('statusPhrase: the pill is the approval axis only', () => {
  test('changes requested is red', () => {
    const m = settled({
      reviews: {
        isApproved: false,
        required: 2,
        given: 0,
        reviewers: [{ username: 'pat', reviewState: 'REQUESTED_CHANGES' }],
      },
    });
    expect(statusPhrase(m)).toEqual({ text: 'changes requested', hue: 'red' });
  });

  test('approved is green', () => {
    expect(statusPhrase(settled())).toEqual({ text: 'approved', hue: 'green' });
  });

  test('a partial approval count is cyan', () => {
    expect(statusPhrase(settled(unapproved(1, 3)))).toEqual({
      text: '1/3 approved',
      hue: 'cyan',
    });
  });

  test('needs review is amber, even with reviewer comments or resolved threads', () => {
    expect(statusPhrase(settled(unapproved(0, 2)))).toEqual({
      text: 'needs review',
      hue: 'amber',
    });
    expect(
      statusPhrase(settled({ ...unapproved(0, 2), reviewerComments: 3 }))
    ).toEqual({ text: 'needs review', hue: 'amber' });
    expect(
      statusPhrase(
        settled({
          ...unapproved(0, 2),
          reviewerComments: 0,
          threadSummary: { awaiting: 0, replied: 0, resolved: 4 },
        })
      )
    ).toEqual({ text: 'needs review', hue: 'amber' });
  });
});
```

Check how `settled()` builds its MR near the top of that file: it must yield `reviews.isApproved: true` by default and accept overrides; if `hasChangesRequested` reads a different reviewer field than `reviewState: 'REQUESTED_CHANGES'`, open `src/data.ts` and use the field it reads.

In `apps/board/src/client/board/__tests__/row-view-dom.test.tsx`, add:

```tsx
test('the pill carries its hue as data, no color class', async () => {
  await render([mr()]);
  const pill = container.querySelector('.tui-phrase')!;
  expect(pill.textContent).toBe('needs review');
  expect(pill.getAttribute('data-hue')).toBe('amber');
  expect(pill.className).toBe('tui-phrase');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `apps/board`: `bun test src/client/board/__tests__/row-status.test.ts src/client/board/__tests__/row-view-dom.test.tsx`
Expected: the four `statusPhrase` tests fail (`hue` undefined, `commented` returned), the pill DOM test fails on `data-hue`.

- [ ] **Step 3: Rewrite `statusPhrase`**

In `row-status.ts`, replace the `statusPhrase` function and its doc comment with:

```ts
export type PillHue = 'red' | 'green' | 'cyan' | 'amber';

/** The pill's phrase: the approval axis only. Mechanical blockers are flags
    beside it and the conversation is the facts line's threads token, so the
    pill always shows where the MR is in review. */
export function statusPhrase(mr: BoardMR): { text: string; hue: PillHue } {
  if (hasChangesRequested(mr)) return { text: 'changes requested', hue: 'red' };
  if (mr.reviews.isApproved) return { text: 'approved', hue: 'green' };
  if (mr.reviews.required > 0 && mr.reviews.given > 0)
    return {
      text: `${mr.reviews.given}/${mr.reviews.required} approved`,
      hue: 'cyan',
    };
  return { text: 'needs review', hue: 'amber' };
}
```

Remove the now-unused `commentsAllResolved` import at the top of `row-status.ts` if nothing else in the file uses it (grep first; `view.ts` keeps its own use).

- [ ] **Step 4: Render `data-hue`**

In `RowView.tsx`, replace `StatusPhrase`:

```tsx
/** The pill's tooltip carries the merge blockers: the gutter dot has the same
    tip, but it yields to the checkbox under the pointer. */
function StatusPhrase({ mr }: { mr: BoardMR }) {
  const { text, hue } = statusPhrase(mr);
  return (
    <span className="tui-phrase" data-hue={hue} title={statusReasons(mr)}>
      {text}
    </span>
  );
}
```

- [ ] **Step 5: Soft-fill pill CSS**

In `style.css`, replace the `.tui-phrase` block (keep the `.t-ok` … `.t-cyan` classes below it, other UI uses them):

```css
.tui-phrase {
  flex-shrink: 0;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--pill);
  background: color-mix(in srgb, var(--pill) 17%, transparent);
}
.tui-phrase[data-hue='amber'] {
  --pill: var(--amber);
}
.tui-phrase[data-hue='cyan'] {
  --pill: var(--cyan);
}
.tui-phrase[data-hue='green'] {
  --pill: var(--green);
}
.tui-phrase[data-hue='red'] {
  --pill: var(--red-text);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/client/board/__tests__/row-status.test.ts src/client/board/__tests__/row-view-dom.test.tsx src/client/board/__tests__/needs-me.test.ts`
Expected: PASS. If an existing test asserted the `commented` or `comments resolved` pill text, update it to `needs review` and its reasoning to "the conversation lives on the threads token".

- [ ] **Step 7: Commit**

```bash
git add apps/board/src/client/board/row-status.ts apps/board/src/client/board/RowView.tsx apps/board/src/style.css apps/board/src/client/board/__tests__/row-status.test.ts apps/board/src/client/board/__tests__/row-view-dom.test.tsx
git commit -m "board: the pill is the approval axis, one soft-fill hue per state"
```

---

### Task 2: Flags are colored words with an icon, draft included

**Files:**
- Modify: `apps/board/src/view.ts:72-101` (`FlagClass`, `statusFlags`)
- Modify: `apps/board/src/client/board/icons.tsx` (append glyphs)
- Modify: `apps/board/src/client/board/RowView.tsx:39-69, 218-232` (`StatusFlags`, the draft chip)
- Modify: `apps/board/src/style.css:361-369` (`.tui-row-flags`) and `:2237-2250` (dead chip rules)
- Test: `apps/board/src/__tests__/view.test.ts:256-309`
- Test: `apps/board/src/client/board/__tests__/row-view-dom.test.tsx:245-258`

**Interfaces:**
- Produces: in `view.ts`, `export type FlagKey = 'draft' | 'auto-merge' | 'conflicts' | 'ci-failing' | 'ci-running' | 'stacked'` and `statusFlags(mr, opts?): { key: FlagKey; text: string; title?: string }[]` (draft first, then the existing order). In `icons.tsx`, `export function FlagGlyph({ kind }: { kind: FlagKey })`. Task 3 consumes `.tui-row-lead` as the flags' container.

- [ ] **Step 1: Update the unit tests to the new shape**

In `apps/board/src/__tests__/view.test.ts`, inside `describe('statusFlags', …)`, replace the `f.text.startsWith('stacked')` style assertions with key assertions and add draft:

```ts
  test('flags carry a key, draft first, stacked last', () => {
    const flags = statusFlags(
      mr({
        isDraft: true,
        isStacked: true,
        targetBranch: 'parent-branch',
        blockers: { hasConflicts: true, pipelineFailing: true },
      } as any)
    );
    expect(flags.map(f => f.key)).toEqual([
      'draft',
      'conflicts',
      'ci-failing',
      'stacked',
    ]);
    expect(flags[0]).toEqual({
      key: 'draft',
      text: 'draft',
      title: 'draft, right-click to mark ready',
    });
    expect(flags[3].title).toBe('stacked on parent-branch');
  });
```

Keep the existing tests but change any `f.cls` reference to `f.key` (values: `'t-ok'` becomes `'auto-merge'`, `'t-cyan'` becomes `'stacked'`, `'t-bad'` becomes `'conflicts'` / `'ci-failing'`).

In `row-view-dom.test.tsx`, replace the test `'mechanical flags share the state line with the pill; the title stands alone'` with:

```tsx
test('flags are icon-and-word tokens on the header line, keyed by data-flag; the title stands alone', async () => {
  await render([
    mr({
      isDraft: true,
      blockers: { any: true, hasConflicts: true, pipelineFailing: true },
    } as never),
  ]);
  const row = container.querySelector('.tui-row')!;
  const flags = [...row.querySelectorAll('.tui-row-0 .tui-flag')];
  expect(flags.map(f => f.getAttribute('data-flag'))).toEqual([
    'draft',
    'conflicts',
    'ci-failing',
  ]);
  expect(flags.map(f => f.textContent)).toEqual([
    'draft',
    'conflicts',
    'ci failing',
  ]);
  for (const f of flags) expect(f.querySelector('svg')).not.toBeNull();
  expect(row.querySelector('[data-part="chip"]')).toBeNull();
  expect(row.querySelector('.tui-row-0 .tui-phrase')).not.toBeNull();
  expect(row.querySelector('.tui-row-1')!.children).toHaveLength(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `apps/board`: `bun test src/__tests__/view.test.ts src/client/board/__tests__/row-view-dom.test.tsx`
Expected: FAIL (`key` undefined, no `.tui-flag` in the DOM).

- [ ] **Step 3: Rewrite `statusFlags`**

In `view.ts`, replace the `FlagClass` type, its comment, and `statusFlags` with:

```ts
/** Keyed, not classed: RowView keys its icon and CSS on the key, so an
    unmapped flag fails to compile instead of rendering grey. */
export type FlagKey =
  | 'draft'
  | 'auto-merge'
  | 'conflicts'
  | 'ci-failing'
  | 'ci-running'
  | 'stacked';

export interface StatusFlag {
  key: FlagKey;
  text: string;
  title?: string;
}

/** GitLab-native facts on the header line: draft first, armed auto-merge,
    then mechanical blockers (conflicts / CI) most severe first, plus the
    stacked marker for MRs targeting a parent branch instead of the default
    branch. */
export function statusFlags(
  mr: BoardMR,
  opts?: { nested?: boolean }
): StatusFlag[] {
  const b = mr.blockers;
  const flags: StatusFlag[] = [];
  if (mr.isDraft)
    flags.push({
      key: 'draft',
      text: 'draft',
      title: 'draft, right-click to mark ready',
    });
  if (mr.autoMergeButton.isActive)
    flags.push({ key: 'auto-merge', text: 'auto-merge' });
  if (b.hasConflicts) flags.push({ key: 'conflicts', text: 'conflicts' });
  if (b.pipelineFailing) flags.push({ key: 'ci-failing', text: 'ci failing' });
  if (b.pipelineRunning) flags.push({ key: 'ci-running', text: 'ci running' });
  // A row nested under its parent already shows the relationship; the flag
  // only earns its place when the parent is not visible above the row.
  if (mr.isStacked && !opts?.nested)
    flags.push({
      key: 'stacked',
      text: 'stacked',
      title: `stacked on ${mr.targetBranch}`,
    });
  return flags;
}
```

Grep the repo for `FlagClass` and fix any other importer (only `RowView.tsx` at the time of writing).

- [ ] **Step 4: Add the glyphs**

Append to `apps/board/src/client/board/icons.tsx` (lucide outlines, ISC licensed, 24-unit viewBox, 12px, stroke currentColor):

```tsx
const GLYPH = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  style: { flexShrink: 0 } as const,
} as const;

const FLAG_PATHS: Record<FlagKey, string> = {
  draft: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  'auto-merge': 'M4 14a1 1 0 0 1-.8-1.6l8.7-10.5a.5.5 0 0 1 .9.4l-1.3 6.9h7.5a1 1 0 0 1 .8 1.6l-8.7 10.5a.5.5 0 0 1-.9-.4l1.3-6.9Z',
  conflicts: 'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21V9a9 9 0 0 0 9 9',
  'ci-failing': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM15 9l-6 6M9 9l6 6',
  'ci-running': 'M21 12a9 9 0 1 1-6.2-8.6',
  stacked: 'M12.8 2.2a2 2 0 0 0-1.7 0L2.9 6.1a1 1 0 0 0 0 1.8l8.2 3.9a2 2 0 0 0 1.7 0l8.2-3.9a1 1 0 0 0 0-1.8ZM2.3 15.4l9 4.3a2 2 0 0 0 1.5 0l9-4.3M2.3 10.9l9 4.3a2 2 0 0 0 1.5 0l9-4.3',
};

/** The header line's flag icon, 12px, in the flag's own color. */
export function FlagGlyph({ kind }: { kind: FlagKey }) {
  return (
    <svg {...GLYPH}>
      <path d={FLAG_PATHS[kind]} />
    </svg>
  );
}

export function ArrowDownGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  );
}

export function ArrowOutGlyph() {
  return (
    <svg {...GLYPH} width={11} height={11}>
      <path d="M7 7h10v10M7 17 17 7" />
    </svg>
  );
}

export function MessageGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  );
}
```

Add `import type { FlagKey } from '../../view.ts';` at the top of `icons.tsx`. If the file's `ICON` style constant conflicts in name, keep `GLYPH` distinct as written.

- [ ] **Step 5: Render the flags as tokens**

In `RowView.tsx`, delete `FLAG_INTENT` and the `Chip` import if nothing else in the file uses `Chip` (the draft chip goes too), and replace `StatusFlags`:

```tsx
function StatusFlags({
  mr,
  nested = false,
}: {
  mr: BoardMR;
  nested?: boolean;
}) {
  return (
    <>
      {statusFlags(mr, { nested }).map(f => (
        <span
          key={f.key}
          className="tui-flag"
          data-flag={f.key}
          title={f.title}
        >
          <FlagGlyph kind={f.key} />
          {f.text}
        </span>
      ))}
    </>
  );
}
```

In `renderRow`, replace the `.tui-row-0` block's `<span className="tui-row-flags">…</span>` (which held the draft `Chip` and `<StatusFlags>`) with:

```tsx
            <span className="tui-row-lead">
              <StatusFlags mr={mr} nested={nested} />
            </span>
```

(Task 3 puts the author, ticket and behind tokens into this same span.) Update the imports: add `FlagGlyph` to the `./icons.tsx` import, change the `../../view.ts` import to `{ behindToken, flattenStack, nestStacks, statusFlags }`.

- [ ] **Step 6: Flag CSS**

In `style.css`, replace `.tui-row-flags { … }` with:

```css
.tui-rows {
  --orange: light-dark(#b15c00, #ff9e64);
}
.tui-row-lead {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 0.72rem;
}
.tui-flag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-weight: 500;
  color: var(--flag);
}
.tui-flag[data-flag='draft'] {
  --flag: color-mix(in srgb, var(--muted-text) 75%, transparent);
}
.tui-flag[data-flag='auto-merge'] {
  --flag: var(--green);
}
.tui-flag[data-flag='conflicts'] {
  --flag: var(--orange);
}
.tui-flag[data-flag='ci-failing'] {
  --flag: var(--red-text);
}
.tui-flag[data-flag='ci-running'] {
  --flag: var(--amber);
}
.tui-flag[data-flag='stacked'] {
  --flag: var(--cyan);
}
```

Put the `--orange` line inside the existing `.tui-rows { … }` custom-property block at the top of the row section rather than a second `.tui-rows` rule. Delete the two dead rules at the bottom of the file, `[data-part='chip'][data-flag] { … }` and `[data-part='chip'][data-draft] { … }`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/__tests__/view.test.ts src/client/board/__tests__/row-view-dom.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/board/src/view.ts apps/board/src/client/board/icons.tsx apps/board/src/client/board/RowView.tsx apps/board/src/style.css apps/board/src/__tests__/view.test.ts apps/board/src/client/board/__tests__/row-view-dom.test.tsx
git commit -m "board: flags are icon-and-word tokens on the header line, draft included"
```

---

### Task 3: The header line earns its keep: author or ticket, then flags, then behind

**Files:**
- Modify: `apps/board/src/view.ts:103-115` (`behindToken`)
- Modify: `apps/board/src/client/board/RowView.tsx` (`AuthorTag`, new `TicketTag`, line 0 lead, line 2)
- Modify: `apps/board/src/style.css:463-466` (`.tui-behind`), `:496-509` (`.tui-author-tag`)
- Test: `apps/board/src/__tests__/view.test.ts:311-330`
- Test: `apps/board/src/client/board/__tests__/row-view-dom.test.tsx`

**Interfaces:**
- Consumes: `.tui-row-lead` from Task 2, `ArrowDownGlyph` / `ArrowOutGlyph` from Task 2.
- Produces: `behindToken(mr): { n: number; text: string; title: string } | null` with `text` = `` `${n} behind` ``; `.tui-author-tag` and `.tui-ticket-tag` on line 0; `.tui-behind` on line 0.

- [ ] **Step 1: Write the failing tests**

In `view.test.ts`, replace the `behindToken` expectations:

```ts
describe('behindToken', () => {
  test('behind by N reads "N behind" with a plural title', () => {
    expect(behindToken(mr({ behindTarget: 3 } as any))).toEqual({
      n: 3,
      text: '3 behind',
      title: '3 commits behind target',
    });
    expect(behindToken(mr({ behindTarget: 1 } as any))).toEqual({
      n: 1,
      text: '1 behind',
      title: '1 commit behind target',
    });
  });
```

Keep the existing null cases (`behindTarget: 0`, `null`) as they are.

In `row-view-dom.test.tsx`, add three tests. `render` takes `showAuthor` from a fixed `false`; change its signature to `async function render(rows, c = ctx(), showAuthor = false)` and pass `showAuthor` through to `<RowView>`.

```tsx
test('the header line leads with the author when the view mixes authors', async () => {
  await render([mr({ behindTarget: 206, blockers: { any: true, hasConflicts: true } } as never)], ctx(), true);
  const lead = container.querySelector('.tui-row-0 .tui-row-lead')!;
  const kinds = [...lead.children].map(c => c.className);
  expect(kinds).toEqual(['tui-author-tag', 'tui-flag', 'tui-behind']);
  expect(lead.querySelector('.tui-author-tag')!.textContent).toContain('Pat');
  const behind = lead.querySelector('.tui-behind')!;
  expect(behind.textContent).toBe('206 behind');
  expect(behind.getAttribute('title')).toBe('206 commits behind target');
  expect(behind.querySelector('svg')).not.toBeNull();
  expect(container.querySelector('.tui-row-2 .tui-behind')).toBeNull();
  expect(container.querySelector('.tui-row-2 .tui-author-tag')).toBeNull();
});

test('with the author hidden the ticket takes its slot on the header line', async () => {
  await render([mr()]);
  const lead = container.querySelector('.tui-row-0 .tui-row-lead')!;
  const ticket = lead.querySelector('a.tui-ticket-tag')!;
  expect(ticket.textContent).toBe('ACME-2214');
  expect(ticket.getAttribute('href')).toContain('ACME-2214');
  expect(ticket.querySelector('svg')).not.toBeNull();
  expect(lead.querySelector('.tui-author-tag')).toBeNull();
});

test('with neither author nor ticket the header line holds only the flags', async () => {
  await render([
    mr({
      title: 'warm the thumbnail cache',
      sourceBranch: 'ops/thumbnails',
      blockers: { any: true, pipelineFailing: true },
    } as never),
  ]);
  const lead = container.querySelector('.tui-row-0 .tui-row-lead')!;
  expect([...lead.children].map(c => c.className)).toEqual(['tui-flag']);
});
```

The facts line test at the top of the file (`'a quiet row: …'`) asserts `.tui-diff` and `.tui-threads`; leave it. `extractTicketId` (`src/ticket.ts`) matches any `word-123` branch segment, so the third test's branch must carry no such segment: `ops/thumbnails` yields null, `feature/ops-3201` would not.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/__tests__/view.test.ts src/client/board/__tests__/row-view-dom.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `behindToken` reads "N behind"**

In `view.ts`:

```ts
export function behindToken(
  mr: BoardMR
): { n: number; text: string; title: string } | null {
  const n = mr.behindTarget;
  if (n == null || n <= 0) return null;
  return {
    n,
    text: `${n} behind`,
    title: `${n} commit${n === 1 ? '' : 's'} behind target`,
  };
}
```

- [ ] **Step 4: Move the author, add the ticket tag, move behind**

In `RowView.tsx`:

```tsx
/** The header line's identity slot when the view mixes authors (the All
    view grouped by anything but author). */
function AuthorTag({ mr }: { mr: BoardMR }) {
  const name = mr.author.name || mr.author.username;
  return (
    <span className="tui-author-tag" title={name}>
      <Invadr
        id={mr.author.username}
        palette="css-vars"
        className="tui-avatar"
      />
      {name}
    </span>
  );
}

/** The same slot when the author is the group header: the ticket, as a
    link, so the line still leads with identity. */
function TicketTag({ ticket }: { ticket: string }) {
  return (
    <a
      className="tui-ticket-tag"
      href={ticketUrl(ticket)}
      target="_blank"
      rel="noopener noreferrer"
      title={`open ${ticket} in Linear`}
      onClick={e => e.stopPropagation()}
    >
      {ticket}
      <ArrowOutGlyph />
    </a>
  );
}
```

In `renderRow`, the header line becomes:

```tsx
          <div className="tui-row-0">
            <span className="tui-row-lead">
              {showAuthor ? (
                <AuthorTag mr={mr} />
              ) : (
                ticket && <TicketTag ticket={ticket} />
              )}
              <StatusFlags mr={mr} nested={nested} />
              {behind && (
                <span className="tui-behind" title={behind.title}>
                  <ArrowDownGlyph />
                  {behind.text}
                </span>
              )}
            </span>
            <SlackMarks mr={mr} />
            <StatusPhrase mr={mr} />
          </div>
```

and the facts line loses the author and behind:

```tsx
          <div className="tui-row-2">
            <span className="tui-mr-iid">!{mr.iid}</span>
            <span className="tui-branch">{mr.sourceBranch}</span>
            {mr.diff && (
              <span
                className="tui-diff"
                title={`${mr.diff.filesChanged} files changed`}
              >
                <span className="tui-adds">+{mr.diff.additions}</span>{' '}
                <span className="tui-dels">−{mr.diff.deletions}</span>
              </span>
            )}
            <Rail mr={mr} now={now} />
          </div>
```

Import `ArrowDownGlyph` and `ArrowOutGlyph` from `./icons.tsx`. The hover-tools `TicketLink` (Linear logo) stays as it is.

- [ ] **Step 5: CSS for the lead tokens**

In `style.css`, replace `.tui-behind { … }` and the `.tui-author-tag` rules with:

```css
.tui-behind {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-weight: 500;
  color: var(--muted-text);
}
.tui-behind svg {
  color: color-mix(in srgb, var(--muted-text) 75%, transparent);
}
/* The header line's identity slot: the author in the mixed view, the
   ticket when the author is the group header. Muted, not purple: the line's
   color belongs to the flags. */
.tui-author-tag,
.tui-ticket-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  color: var(--muted-text);
  white-space: nowrap;
  text-decoration: none;
}
.tui-ticket-tag {
  font-weight: 500;
}
.tui-ticket-tag svg {
  color: color-mix(in srgb, var(--muted-text) 75%, transparent);
}
.tui-ticket-tag:hover {
  color: var(--fg);
  text-decoration: underline;
}
.tui-author-tag .tui-avatar {
  width: 12px;
  height: 12px;
}
```

`DecisionQueueModal.tsx` also uses `.tui-author-tag`; the queue card inherits the muted color, which the design wants everywhere. Check its capture (`queue-*.png` if present) in Task 6.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/__tests__/view.test.ts src/client/board/__tests__/row-view-dom.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/board/src/view.ts apps/board/src/client/board/RowView.tsx apps/board/src/style.css apps/board/src/__tests__/view.test.ts apps/board/src/client/board/__tests__/row-view-dom.test.tsx
git commit -m "board: the header line leads with the author or ticket, behind count joins the flags"
```

---

### Task 4: The threads token: full weight, with await / replied qualifiers

**Files:**
- Modify: `apps/board/src/client/board/CommentsDrawer.tsx:52-83` (`ThreadsLink`)
- Modify: `apps/board/src/client/board/RowView.tsx:128-159` (`Rail`)
- Modify: `apps/board/src/style.css:467-495` (`.tui-rail`, `.tui-threads`)
- Test: `apps/board/src/client/board/__tests__/row-view-dom.test.tsx`

**Interfaces:**
- Consumes: `MessageGlyph` from Task 2; `RowContext.self` (already on the context).
- Produces: `ThreadsLink` props gain `awaitYou: number` and `replied: boolean`; the token renders `.tui-threads > svg + .tui-threads-count [+ .tui-threads-await | .tui-threads-replied]`. `Rail` takes `self: string | null`.

- [ ] **Step 1: Write the failing tests**

In `row-view-dom.test.tsx`:

```tsx
test('the threads token: icon, count, and no qualifier on a stranger MR', async () => {
  await render([mr({ threadSummary: { awaiting: 2, replied: 1, resolved: 2 } } as never)]);
  const link = container.querySelector('.tui-threads')!;
  expect(link.querySelector('svg')).not.toBeNull();
  expect(link.querySelector('.tui-threads-count')!.textContent).toBe('5 threads');
  expect(link.textContent).toBe('5 threads');
  expect(link.querySelector('.tui-threads-await')).toBeNull();
  expect(link.querySelector('.tui-threads-replied')).toBeNull();
});

test('on my own MR the token counts the threads awaiting me', async () => {
  await render(
    [mr({ author: { username: 'me', name: 'Me' }, threadSummary: { awaiting: 2, replied: 0, resolved: 2 } } as never)],
    ctx({ self: 'me' })
  );
  const link = container.querySelector('.tui-threads')!;
  expect(link.querySelector('.tui-threads-count')!.textContent).toBe('4 threads');
  expect(link.querySelector('.tui-threads-await')!.textContent).toBe('2 await you');
  expect(link.textContent).not.toContain('·');
  await render(
    [mr({ author: { username: 'me', name: 'Me' }, threadSummary: { awaiting: 1, replied: 0, resolved: 0 } } as never)],
    ctx({ self: 'me' })
  );
  expect(container.querySelector('.tui-threads-await')!.textContent).toBe('1 awaits you');
});

test("on someone else's MR the token says the author replied to my threads", async () => {
  await render(
    [mr({ threadSummary: { awaiting: 0, replied: 1, resolved: 1 }, myThreads: { awaiting: 0, replied: 1, resolved: 1 } } as never)],
    ctx({ self: 'me' })
  );
  expect(container.querySelector('.tui-threads-replied')!.textContent).toBe('author replied');
  await render(
    [mr({ threadSummary: { awaiting: 1, replied: 1, resolved: 0 }, myThreads: { awaiting: 1, replied: 1, resolved: 0 } } as never)],
    ctx({ self: 'me' })
  );
  expect(container.querySelector('.tui-threads-replied')).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/client/board/__tests__/row-view-dom.test.tsx`
Expected: FAIL (`.tui-threads-count` missing).

- [ ] **Step 3: Render the token**

In `CommentsDrawer.tsx`, replace `ThreadsLink`:

```tsx
/** The facts line's threads token, the drawer's entry. `awaitYou` counts
    the seat's own MR threads waiting on them; `replied` says the author
    answered the seat's threads on someone else's MR. */
function ThreadsLink({
  mr,
  count,
  fresh,
  grew,
  awaitYou,
  replied,
  onOpen,
}: {
  mr: BoardMR;
  count: number;
  fresh: boolean;
  grew: number;
  awaitYou: number;
  replied: boolean;
  onOpen: () => void;
}) {
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const lit = fresh && openedAt !== count;
  return (
    <CommentsTrigger
      mr={mr}
      className="tui-threads"
      title={
        lit ? `${grew} new since you last looked` : 'open the comments drawer'
      }
      fresh={lit}
      onOpen={() => {
        setOpenedAt(count);
        onOpen();
      }}
    >
      <MessageGlyph />
      <span className="tui-threads-count">
        {count} thread{count === 1 ? '' : 's'}
      </span>
      {awaitYou > 0 && (
        <span className="tui-threads-await">
          {awaitYou} await{awaitYou === 1 ? 's' : ''} you
        </span>
      )}
      {replied && <span className="tui-threads-replied">author replied</span>}
    </CommentsTrigger>
  );
}
```

Import `MessageGlyph` from `./icons.tsx`.

- [ ] **Step 4: Derive the qualifiers in `Rail`**

In `RowView.tsx`, give `Rail` the seat and compute both:

```tsx
function Rail({
  mr,
  now,
  self,
}: {
  mr: BoardMR;
  now: number;
  self: string | null;
}) {
  const count = commentCount(mr);
  const seen = mr.webUrl ? seenCount(mr.webUrl) : null;
  const newness = threadNewness(seen, count);
  const { record } = newness;
  const webUrl = mr.webUrl;
  useEffect(() => {
    if (record !== null && webUrl) markSeen(webUrl, record);
  }, [record, webUrl]);
  const grew = seen === null ? 0 : count - seen;
  const mine = self !== null && mr.author.username === self;
  const awaitYou = mine ? (mr.threadSummary?.awaiting ?? 0) : 0;
  const my = mr.myThreads;
  const replied =
    !mine && !!my && my.awaiting === 0 && my.replied + my.resolved > 0;
  return (
    <span className="tui-rail">
      {count > 0 && (
        <ThreadsLink
          mr={mr}
          count={count}
          fresh={newness.fresh}
          grew={grew}
          awaitYou={awaitYou}
          replied={replied}
          onOpen={() => mr.webUrl && markSeen(mr.webUrl, count)}
        />
      )}
      <span className="tui-age" title="last updated">
        {ago(mr.updatedAt, now)}
      </span>
    </span>
  );
}
```

and pass `self={ctx.self}` at the call site in `renderRow`.

- [ ] **Step 5: Token CSS**

In `style.css`, replace the `.tui-threads` rules:

```css
/* The threads token: the drawer's entry, read at full weight. Newness is
   accent and bold with a dot; the qualifiers are their own color so no
   glyph separates them from the count. */
.tui-threads {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 500;
  color: var(--fg);
}
.tui-threads svg {
  color: var(--muted-text);
}
.tui-threads[data-new] {
  color: var(--accent-text);
  font-weight: 700;
}
.tui-threads[data-new] svg {
  color: var(--accent-text);
}
.tui-threads[data-new] .tui-threads-count::after {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 5px;
  border-radius: 50%;
  background: var(--accent);
  vertical-align: middle;
}
.tui-threads-await {
  color: var(--amber);
  font-weight: 600;
}
.tui-threads-replied {
  color: var(--accent-text);
  font-weight: 600;
}
.tui-threads:hover .tui-threads-count {
  text-decoration: underline;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/client/board/__tests__/row-view-dom.test.tsx src/client/board/__tests__/threads-seen.test.ts`
Expected: PASS. The earlier tests that read `.tui-threads` `textContent` (`'1 thread'`, `'3 threads'`) still hold because the glyph has no text and the fixtures carry no qualifier.

- [ ] **Step 7: Commit**

```bash
git add apps/board/src/client/board/CommentsDrawer.tsx apps/board/src/client/board/RowView.tsx apps/board/src/style.css apps/board/src/client/board/__tests__/row-view-dom.test.tsx
git commit -m "board: the threads token reads at full weight with await and replied qualifiers"
```

---

### Task 5: All clear is the words and the sun

**Files:**
- Modify: `apps/board/src/client/board/row-status.ts:618-624` (`reviewerLine`'s clear return)
- Modify: `apps/board/src/style.css:611-613` (`.tui-status-sun + .tui-status-detail`)
- Test: `apps/board/src/client/board/__tests__/row-status.test.ts:64-71`
- Test: `apps/board/src/client/board/__tests__/status-line-dom.test.tsx:181-207`

- [ ] **Step 1: Update the tests**

In `row-status.test.ts`, the sun test:

```ts
  test("someone else's settled MR earns the sun: all clear, open verb, no bar", () => {
    const s = rowStatus(settled(), NOW, NONE, ME);
    expect(s.line.tone).toBe('clear');
    expect(s.line.word).toBe('all clear');
    expect(s.line.detail).toBeUndefined();
    expect(s.line.verbs.map(v => v.kind)).toEqual(['open-mr']);
    expect(s.more).toEqual([]);
    expect(s.bar).toBeNull();
  });
```

In `status-line-dom.test.tsx`, the all-clear test renders a line without `detail` and asserts no detail node:

```tsx
test('the all-clear line puts the word first, then the sun, then the open verb', async () => {
  await render(
    {
      line: {
        tone: 'clear',
        word: 'all clear',
        verbs: [{ kind: 'open-mr', label: 'open ↗' }],
      },
      more: [],
      bar: null,
    },
    ctx()
  );
  const line = container.querySelector('.tui-status[data-tone="clear"]')!;
  const word = line.querySelector('.tui-status-word')!;
  expect(word.textContent).toBe('all clear');
  expect(word.querySelector('svg')).toBeNull();
  expect(word.nextElementSibling!.className).toBe('tui-status-sun');
  expect(word.nextElementSibling!.querySelector('svg')).not.toBeNull();
  expect(line.querySelector('.tui-status-detail')).toBeNull();
  expect(
    container.querySelector('button[data-verb="open-mr"]')!.textContent
  ).toBe('open ↗');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/client/board/__tests__/row-status.test.ts src/client/board/__tests__/status-line-dom.test.tsx`
Expected: the row-status sun test fails (`detail` is `'enjoy the sunshine'`); the DOM test passes already (it renders what it is given) and stays as the guard.

- [ ] **Step 3: Drop the detail**

In `row-status.ts`, the last return of `reviewerLine` becomes:

```ts
  return { tone: 'clear', word: 'all clear', verbs: [OPEN] };
```

Delete the `.tui-status-sun + .tui-status-detail { margin-left: 4px; }` rule in `style.css`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/client/board/__tests__/row-status.test.ts src/client/board/__tests__/status-line-dom.test.tsx src/client/board/__tests__/needs-me.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client/board/row-status.ts apps/board/src/style.css apps/board/src/client/board/__tests__/row-status.test.ts apps/board/src/client/board/__tests__/status-line-dom.test.tsx
git commit -m "board: all clear is the words and the sun"
```

---

### Task 6: Visual parity: recapture, compare against the approved renders, fix drift

**Files:**
- Modify: `apps/board/tests/baselines/*.png` (recaptured)
- Modify: `apps/board/src/style.css` (only what the pixels demand)
- Modify: `docs/design/board/README.md`

- [ ] **Step 1: Full gates before pixels**

From the repo root:

```bash
bun run tui-kit:build
bun run board:typecheck
bun run board:lint
bun run board:test
bash scripts/repo-purity.sh
```

Expected: all green. Fix anything red before capturing.

- [ ] **Step 2: Recapture and compare**

From `apps/board`:

```bash
bun run capture:baseline
bun run capture
bun run capture:compare
```

Expected: `capture:compare` reports every shot identical (26/26 at the time of writing). A recapture is deterministic; a mismatch here means a flaky font or animation, not a design defect.

- [ ] **Step 3: Look at the pixels against the approved renders**

Serve the fixture board (`BOARD_FIXTURE=$(pwd)/tests/fixture bun run src/server.ts`, port 7941) and, with Fast Browser, screenshot the row list at 1280 wide in both themes (`document.documentElement.style.colorScheme` flips them; also `localStorage.mrs-theme`) into `/Users/matt/.fast-browser/output/mr-row-b/`. Read each PNG beside `docs/design/board/renders/B-header-earns-its-keep.{dark,light}.png` and check, row by row:

- line 0: author (muted, 12px avatar) or ticket, then flags as icon+word in their hue (conflicts orange, ci failing red), then `N behind` muted; marks and pill at the corner; the pill soft-filled in its hue with no border
- line 1: the title alone
- line 2: `!iid`, branch, `+adds −dels` as the only colored numbers; the threads token in foreground weight 500 with the message glyph; age dim
- line 3: unchanged; the all-clear row reads `all clear` + sun, no tagline
- hover (`rowhover-*`): the square checkbox in the dot's slot, tools left of the verb
- the stack shot: 20px indent, the rail's arm ending at the child dot

Also open the decision queue (`queue-*` shot if the capture set has one, else click the queue button) and confirm the muted author tag reads fine there.

Differences in font rendering between the mockup's Inter and the app's system stack are expected; differences in layout, spacing, color or weight are defects: fix them in `style.css`, re-run Step 2, and look again. Do not sign off from the DOM.

- [ ] **Step 4: Correct the design record**

In `docs/design/board/README.md`, under "The rulings", change the pill bullet to name the four states the code has (needs review amber, N/M approved cyan, approved green, changes requested red) and say that `commented` and `comments resolved` are conversation states carried by the threads token, not the pill; in the threads-token bullet, replace `· N await you` / `· author replied` with the qualifier as its own colored span, no glyph, per the no-separator law. Add one line under "Implementation touch points": implemented on branch `mr-row-b` (PR number once known).

- [ ] **Step 5: Commit**

```bash
git add apps/board/tests/baselines apps/board/src/style.css docs/design/board/README.md
git commit -m "board: recapture baselines for direction B; design record matches the code"
```

---

### Task 7: Ship

- [ ] **Step 1: Final gates**

From the repo root: `bun run tui-kit:build && bun run board:typecheck && bun run board:lint && bun run board:test && bash scripts/repo-purity.sh`. Expected: green.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin mr-row-b
gh pr create --title "board: mr row direction B" --body-file - <<'EOF'
## MR row: direction B

The board's row tuned to the approved density study (`docs/design/board/README.md`): same four lines and anchored corner, calmer metadata, distinct state colors.

### What changed

**Header line** (`RowView.tsx`, `view.ts`)

- Leads with the author (muted, avatar) in the mixed view, the ticket link when grouped by author
- Flags are icon-and-word tokens keyed by `data-flag`; draft joins them; conflicts orange, ci failing red
- The behind count moves here as `N behind`, so the facts line's diff is its only colored number

**Pill** (`row-status.ts`)

- Owns the approval axis: needs review (amber), N/M approved (cyan), approved (green), changes requested (red); soft fill, no border
- `commented` and `comments resolved` leave the pill; `statusBucket` grouping unchanged

**Threads token** (`CommentsDrawer.tsx`)

- Full weight, message glyph, accent + dot when new; `N await you` on my MR, `author replied` on theirs

**Also**

- `all clear` keeps the sun and drops the tagline
- Baselines recaptured; design README corrected to the four pill states

---

**Verification Evidence**

Fixture board rows compared against `docs/design/board/renders/B-*.png` in both themes; `capture:compare` green; `needs-me.test.ts` unchanged and green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 3: CodeRabbit and CI**

Wait for CodeRabbit's review and address every actionable finding; wait for CI green. Then ask Matt to confirm the merge.
